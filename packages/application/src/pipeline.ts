import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import {
  ChangeSchema, ReviewResultSchema, TestPlanSchema, ReleaseAssessmentSchema, transition, affectedTests,
  enforceRequiredTests, assessRelease, type AgentExecutor, type ChangeRef, type EventLogger, type SourceControlProvider,
} from '../../core/src/index.js';
import { loadConfig, type ExecutorConfig } from '../../config/src/index.js';
import { MockAgentExecutor, CommandAgentExecutor, type AgentContext } from '../../agent-runtime/src/index.js';
import { assertCheckout } from '../../adapters/src/local-git.js';
import { executeTest } from './execution.js';
import { digest, RunStore, type Run } from './store.js';

export class Pipeline {
  private constructor(readonly root: string, readonly settings: Awaited<ReturnType<typeof loadConfig>>, readonly store: RunStore,
    readonly logger: EventLogger, private readonly override?: 'mock') {}
  static async create(root: string, logger: EventLogger, override?: 'mock') {
    root = await realpath(root);
    return new Pipeline(root, await loadConfig(root), new RunStore(root), logger, override);
  }
  private executor(config: ExecutorConfig): AgentExecutor {
    if (this.override === 'mock' || config.executor === 'mock') return new MockAgentExecutor();
    return new CommandAgentExecutor({ ...config, cwd: this.root });
  }
  private context(run: Run): AgentContext {
    return { change: run.change, diff: run.diff, repositoryInstructions: this.settings.instructions,
      reviewFocus: this.settings.reviewPolicy.focus,
      candidateTests: this.settings.config.testing.discovery.mode === 'configured' ? this.settings.config.testing.commands :
        affectedTests(run.change.files, this.settings.config.testing.commands) };
  }
  async load(id?: string) {
    const run = await this.store.load(id);
    if (run.change.repository.root !== this.root) throw new Error('Saved Change belongs to a different checkout');
    if (run.configDigest !== digest(this.settings)) throw new Error('Configuration, policy or instructions changed; run review again');
    return run;
  }
  async review(provider: SourceControlProvider, ref: ChangeRef): Promise<Run> {
    const [source, diff, files] = await Promise.all([provider.getChange(ref), provider.getDiff(ref), provider.getChangedFiles(ref)]);
    const run: Run = { version: 1, change: ChangeSchema.parse({ ...source, files, status: 'CREATED', risks: [], findings: [], evidence: [] }),
      diff, configDigest: digest(this.settings), executors: {}, evidence: [], skippedStages: [], updatedAt: new Date().toISOString() };
    await this.store.save(run);
    this.logger.emit('change.loaded', { changeId: run.change.id, sourceRevision: source.sourceRevision, files: files.length });
    if (!this.settings.config.lifecycle.review) { run.skippedStages.push('review'); await this.store.save(run); return run; }
    transition(run.change, 'UNDER_REVIEW'); await this.store.save(run);
    const executor = this.executor(this.settings.config.agents.review); run.executors.review = executor.name;
    this.logger.emit('review.started', { changeId: run.change.id, executor: executor.name });
    try {
      // Validate again at the application boundary: executors are replaceable and not trusted.
      const result = ReviewResultSchema.parse(await executor.execute({ kind: 'review', input: this.context(run), outputSchema: ReviewResultSchema }));
      run.review = result; run.change.risks = result.risks; run.change.findings = result.findings;
      run.change.evidence.push({ id: randomUUID(), type: 'review', source: executor.name,
        status: executor.name === 'mock' ? 'warning' : 'passed', summary: result.summary,
        sourceRevision: source.sourceRevision, targetRevision: source.targetRevision, recordedAt: new Date().toISOString() });
      transition(run.change, 'REVIEWED');
      this.logger.emit('review.completed', { changeId: run.change.id, risks: result.risks.length, findings: result.findings.length });
      await this.store.save(run); return run;
    } catch (error) {
      transition(run.change, 'REVIEW_FAILED'); run.lastError = message(error); await this.store.save(run);
      this.logger.emit('review.failed', { changeId: run.change.id, error: run.lastError }); throw error;
    }
  }
  async plan(run: Run): Promise<Run> {
    if (!this.settings.config.lifecycle.testPlanning) {
      run.skippedStages.push('testPlanning'); await this.store.save(run); return run;
    }
    if (this.settings.config.lifecycle.review && !run.review) throw new Error('A successful review is required before test-plan');
    const executor = this.executor(this.settings.config.agents.testPlanning); run.executors.testPlanning = executor.name;
    // A new plan invalidates all previous test evidence and approval, even when planning fails.
    run.change.evidence = run.change.evidence.filter(e => e.type !== 'test');
    delete run.change.testPlan; delete run.change.releaseAssessment; delete run.humanApproval; delete run.lastError;
    try {
      const context = this.context(run);
      const plan = TestPlanSchema.parse(await executor.execute({ kind: 'test-planning', input: context, outputSchema: TestPlanSchema }));
      run.change.testPlan = enforceRequiredTests(plan, context.candidateTests);
      transition(run.change, 'TEST_PLANNED');
      this.logger.emit('test_plan.generated', { changeId: run.change.id, tests: run.change.testPlan.tests.length, executor: executor.name });
      await this.store.save(run); return run;
    } catch (error) {
      transition(run.change, 'BLOCKED'); run.lastError = message(error); await this.store.save(run);
      this.logger.emit('test_plan.failed', { changeId: run.change.id, error: run.lastError }); throw error;
    }
  }
  async verify(run: Run): Promise<Run> {
    if (!this.settings.config.lifecycle.testExecution) {
      run.skippedStages.push('testExecution'); await this.store.save(run); return run;
    }
    if (!run.change.testPlan) throw new Error('No TestPlan; run test-plan first');
    transition(run.change, 'VALIDATING');
    run.change.evidence = run.change.evidence.filter(e => e.type !== 'test');
    delete run.change.releaseAssessment; delete run.humanApproval; delete run.lastError;
    await this.store.save(run);
    try {
      await assertCheckout(this.root, run.change.sourceRevision);
      for (const test of run.change.testPlan.tests) {
        await assertCheckout(this.root, run.change.sourceRevision);
        run.change.evidence.push(await executeTest(test, run.change, this.settings.config, this.logger));
        await this.store.save(run);
        await assertCheckout(this.root, run.change.sourceRevision);
      }
      if (run.change.evidence.some(e => e.type === 'test' && e.status === 'failed')) transition(run.change, 'VALIDATION_FAILED');
      await this.store.save(run); return run;
    } catch (error) {
      transition(run.change, 'VALIDATION_FAILED'); run.lastError = message(error);
      await this.store.save(run); this.logger.emit('validation.failed', { changeId: run.change.id, error: run.lastError }); throw error;
    }
  }
  async assess(run: Run, approver?: string): Promise<Run> {
    if (!this.settings.config.lifecycle.releaseAssurance) throw new Error('Release assurance is disabled by repository configuration');
    if (approver?.trim()) run.humanApproval = { approver: approver.trim(), sourceRevision: run.change.sourceRevision,
      targetRevision: run.change.targetRevision, at: new Date().toISOString() };
    const assessment = assessRelease(run.change, this.settings.config.policies.release, {
      reviewCompleted: !!run.review, mockUsed: Object.values(run.executors).includes('mock'),
      humanApproval: run.humanApproval, skippedStages: [...new Set(run.skippedStages)], error: run.lastError,
    });
    run.change.releaseAssessment = ReleaseAssessmentSchema.parse(assessment);
    transition(run.change, assessment.status === 'blocked' ? 'BLOCKED' : 'ASSESSED');
    await this.store.save(run);
    this.logger.emit('release.assessed', { changeId: run.change.id, status: assessment.status }); return run;
  }
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
