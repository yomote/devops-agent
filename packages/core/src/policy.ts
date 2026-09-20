import { z } from 'zod';
import { FindingSeveritySchema, SeveritySchema, type Change, type ReleaseAssessment } from './domain.js';

export const ReleasePolicySchema = z.object({
  requireAllRequiredTests: z.boolean().default(true), requireHumanApproval: z.boolean().default(false),
  requireReview: z.boolean().default(true),
  blockOn: z.object({
    findingSeverity: z.array(FindingSeveritySchema).default(['critical', 'error']),
    riskSeverity: z.array(SeveritySchema).default(['critical']),
  }).strict().default({}),
}).strict();
export type ReleasePolicy = z.infer<typeof ReleasePolicySchema>;
export function assessRelease(change: Change, policy: ReleasePolicy, context: {
  reviewCompleted: boolean; mockUsed: boolean; humanApproval?: { approver: string; sourceRevision: string; targetRevision: string };
  skippedStages?: string[]; error?: string;
}): ReleaseAssessment {
  const blockers: string[] = [], warnings: string[] = [];
  if (context.error) blockers.push(context.error);
  if (policy.requireReview && !context.reviewCompleted) blockers.push('Structured review has not completed');
  for (const finding of change.findings) {
    if (policy.blockOn.findingSeverity.includes(finding.severity)) blockers.push(`Finding ${finding.id}: ${finding.title}`);
    else if (finding.severity !== 'info') warnings.push(`Finding ${finding.id}: ${finding.title}`);
  }
  for (const risk of change.risks) {
    if (policy.blockOn.riskSeverity.includes(risk.severity)) blockers.push(`Risk ${risk.id}: ${risk.description}`);
    else if (risk.severity === 'high' || risk.severity === 'medium') warnings.push(`Risk ${risk.id}: ${risk.description}`);
  }
  if (policy.requireAllRequiredTests && (!change.testPlan || change.testPlan.tests.length === 0)) blockers.push('No validation plan is available');
  for (const test of change.testPlan?.tests ?? []) {
    const evidence = change.evidence.filter(e => e.type === 'test' && e.testId === test.id &&
      e.sourceRevision === change.sourceRevision && e.targetRevision === change.targetRevision &&
      e.command === test.command && e.cwd === test.cwd).at(-1);
    if (evidence?.status !== 'passed') {
      const message = `${test.id}: ${evidence?.summary ?? 'matching test evidence is missing'}`;
      if (test.required && policy.requireAllRequiredTests) blockers.push(message); else warnings.push(message);
    }
  }
  if (policy.requireHumanApproval && (!context.humanApproval ||
    context.humanApproval.sourceRevision !== change.sourceRevision || context.humanApproval.targetRevision !== change.targetRevision))
    blockers.push('Human approval for this revision is required (use release-check --approve-by NAME)');
  if (context.mockUsed) warnings.push('MOCK agent output was used; real review and test planning are still required');
  for (const stage of context.skippedStages ?? []) warnings.push(`Lifecycle stage disabled: ${stage}`);
  const status = blockers.length ? 'blocked' : warnings.length ? 'needs-review' : 'ready';
  return { status, summary: status === 'ready' ? 'Configured release requirements are satisfied' :
    status === 'blocked' ? `${blockers.length} release blocker(s)` : 'Human review of warnings is required', blockers, warnings };
}
