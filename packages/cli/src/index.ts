#!/usr/bin/env node
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { initRepository } from '../../config/src/index.js';
import { GitHubProvider, LocalGitProvider, AzureDevOpsProvider } from '../../adapters/src/index.js';
import { Pipeline } from '../../application/src/pipeline.js';
import type { Run } from '../../application/src/store.js';
import type { EventLogger, SourceControlProvider } from '../../core/src/index.js';
import { report } from './report.js';
import { packageVersion } from '../../platform/src/package.js';

interface Options { repo: string; json?: boolean; quiet?: boolean; executor?: string; base?: string; head?: string; pr?: number; provider?: string; runId?: string; approveBy?: string; preset?: string; }
const program = new Command().name('devops-agent').description('Control the Change lifecycle after coding').version(packageVersion);
const positiveInteger = (value: string) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new InvalidArgumentError('Must be a positive integer'); return n; };
function common(command: Command) {
  return command.option('--repo <path>', 'repository root', '.').option('--json', 'print machine-readable JSON on stdout')
    .option('--quiet', 'suppress structured event logs');
}
function sourceOptions(command: Command) {
  return command.option('--base <revision>', 'local Git base (default: main)').option('--head <revision>', 'local Git head (default: HEAD)')
    .option('--provider <type>', 'local-git or github').option('--pr <number>', 'GitHub PR number', positiveInteger);
}
function agentOptions(command: Command) { return command.option('--executor <type>', 'override both executors with mock'); }
function logger(options: Options): EventLogger {
  return { emit(event, fields = {}) { if (!options.quiet) process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }) + '\n'); } };
}
function provider(pipeline: Pipeline, options: Options): SourceControlProvider {
  const config = pipeline.settings.config.provider;
  // Explicit local revision flags always work in a repository configured for GitHub.
  const type = options.provider ?? (options.pr ? 'github' : options.base || options.head ? 'local-git' : config.type);
  if (options.pr && type !== 'github') throw new Error('--pr requires the GitHub provider');
  if (type === 'local-git') return new LocalGitProvider(pipeline.root);
  if (type === 'azure-devops') return new AzureDevOpsProvider();
  if (type !== 'github') throw new Error(`Unsupported provider: ${type}`);
  if (options.base || options.head) throw new Error('Use --pr for GitHub, or --provider local-git with --base/--head');
  if (config.type !== 'github' || !config.repository) throw new Error('Set provider.repository to owner/name in GitHub configuration');
  return new GitHubProvider({ root: pipeline.root, repository: config.repository, token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN });
}
function output(run: Run, options: Options) { process.stdout.write((options.json ? JSON.stringify(run, null, 2) : report(run)) + '\n'); }
function exitStatus(run: Run): number {
  const status = run.change.releaseAssessment?.status;
  return status === 'blocked' ? 2 : status === 'needs-review' ? 3 : 0;
}
async function withPipeline(options: Options, action: (pipeline: Pipeline) => Promise<void>) {
  try {
    if (options.executor && options.executor !== 'mock') throw new Error('--executor accepts mock; configure command executors in config.yaml');
    const pipeline = await Pipeline.create(path.resolve(options.repo), logger(options), options.executor as 'mock' | undefined);
    const unlock = await pipeline.store.lock();
    try { await action(pipeline); } finally { await unlock(); }
  } catch (error) { fail(error, options); }
}
function fail(error: unknown, options: Options) {
  const message = error instanceof Error ? error.message : String(error);
  if (options.json) process.stdout.write(JSON.stringify({ error: { message }, exitCode: 1 }) + '\n');
  else process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
common(program.command('init').description('Create thin repository configuration without overwriting existing files'))
  .option('--preset <name>', 'initialize an included repository contract: tech-playground')
  .action(async (options: Options) => {
    try {
      if (options.preset && options.preset !== 'tech-playground') throw new Error(`Unknown preset: ${options.preset}`);
      const result = await initRepository(path.resolve(options.repo), options.preset as 'tech-playground' | undefined); process.stdout.write((options.json ? JSON.stringify(result) :
      `Created: ${result.created.join(', ') || '(none)'}\nPreserved: ${result.skipped.join(', ') || '(none)'}\nEdit .devops-agent/config.yaml to register trusted test commands.`) + '\n'); }
    catch (error) { fail(error, options); }
  });
agentOptions(sourceOptions(common(program.command('review').description('Load an immutable Change and produce structured review'))))
  .action((options: Options) => withPipeline(options, async pipeline => output(await pipeline.review(provider(pipeline, options), options), options)));
agentOptions(common(program.command('test-plan').description('Plan change-specific validation'))).option('--run-id <id>', 'saved Change ID (default: latest)')
  .action((options: Options) => withPipeline(options, async pipeline => output(await pipeline.plan(await pipeline.load(options.runId)), options)));
common(program.command('verify').description('Execute only registered, permitted test commands')).option('--run-id <id>', 'saved Change ID')
  .action((options: Options) => withPipeline(options, async pipeline => {
    const run = await pipeline.verify(await pipeline.load(options.runId)); output(run, options);
    if (run.change.evidence.some(e => e.type === 'test' && e.status !== 'passed')) process.exitCode = 2;
  }));
common(program.command('release-check').description('Evaluate deterministic release policy')).option('--run-id <id>', 'saved Change ID')
  .option('--approve-by <name>', 'record explicit human attestation for this revision')
  .action((options: Options) => withPipeline(options, async pipeline => {
    const run = await pipeline.assess(await pipeline.load(options.runId), options.approveBy); output(run, options); process.exitCode = exitStatus(run);
  }));
agentOptions(sourceOptions(common(program.command('run').description('Review → test-plan → verify → release-check'))))
  .action((options: Options) => withPipeline(options, async pipeline => {
    let run = await pipeline.review(provider(pipeline, options), options);
    try {
      run = await pipeline.plan(run);
      if (pipeline.settings.config.lifecycle.testExecution) run = await pipeline.verify(run);
      else { run.skippedStages.push('testExecution'); await pipeline.store.save(run); }
    } catch (error) {
      // Preserve failure and still produce a deterministic blocked report when possible.
      run = await pipeline.load(); run.lastError = error instanceof Error ? error.message : String(error); await pipeline.store.save(run);
    }
    if (pipeline.settings.config.lifecycle.releaseAssurance) run = await pipeline.assess(run);
    output(run, options); process.exitCode = exitStatus(run) || (run.lastError ? 1 : 0);
  }));
common(program.command('show').description('Inspect a persisted Change and evidence')).option('--run-id <id>', 'saved Change ID')
  .action((options: Options) => withPipeline(options, async pipeline => output(await pipeline.store.load(options.runId), options)));
await program.parseAsync(process.argv);
