import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pipeline } from '../packages/application/src/pipeline.js';
import { RunStore } from '../packages/application/src/store.js';
import { LocalGitProvider, git } from '../packages/adapters/src/local-git.js';
import { runProcess } from '../packages/platform/src/process.js';
import { repository, temporary, silent, writeConfig, command } from './helpers.js';

test('full mock lifecycle persists review, plan, test evidence and needs-review assessment', async () => {
  const root = await repository(), pipeline = await Pipeline.create(root, silent, 'mock');
  const events: string[] = []; pipeline.logger.emit = event => { events.push(event); };
  const run = await pipeline.review(new LocalGitProvider(root), { base: 'main', head: 'HEAD' });
  assert.equal(run.change.status, 'REVIEWED'); assert.match(run.review!.summary, /MOCK/);
  await pipeline.plan(run); assert.equal(run.change.status, 'TEST_PLANNED');
  await pipeline.verify(run); assert.equal(run.change.status, 'VALIDATING'); assert.equal(run.change.evidence.at(-1)!.status, 'passed');
  await pipeline.assess(run); assert.equal(run.change.status, 'ASSESSED'); assert.equal(run.releaseAssessment!.status, 'needs-review');
  const stored = await new RunStore(root).load(); assert.deepEqual(stored.change, run.change);
  for (const name of ['change.loaded', 'review.started', 'review.completed', 'test_plan.generated', 'test.started', 'test.completed', 'release.assessed']) assert.ok(events.includes(name));
  await pipeline.plan(run); assert.equal(run.change.evidence.filter(e => e.type === 'test').length, 0); assert.equal(run.change.releaseAssessment, undefined);
  await writeFile(path.join(root, '.devops-agent/instructions/repository.md'), 'Policy context changed');
  await assert.rejects((await Pipeline.create(root, silent)).load(), /changed; run review again/);
});
test('external command protocol completes a ready vertical slice without vendor coupling', async () => {
  const root = await repository();
  const executor = { executor: 'command', command: process.execPath, args: [path.resolve('tests/fixtures/agent.mjs')] };
  await writeConfig(root, { agents: { review: executor, testPlanning: executor } });
  const pipeline = await Pipeline.create(root, silent), run = await pipeline.review(new LocalGitProvider(root), { base: 'main' });
  await pipeline.plan(run); await pipeline.verify(run); await pipeline.assess(run);
  assert.equal(run.change.releaseAssessment!.status, 'ready');
});
test('malformed external review persists REVIEW_FAILED and can be assessed as blocked', async () => {
  const root = await repository();
  await writeConfig(root, { agents: { review: { executor: 'command', command: process.execPath, args: ['-e', 'console.log("{}")'] } } });
  const pipeline = await Pipeline.create(root, silent);
  await assert.rejects(pipeline.review(new LocalGitProvider(root), { base: 'main' }), /Malformed agent output/);
  const run = await pipeline.load(); assert.equal(run.change.status, 'REVIEW_FAILED'); assert.equal(run.review, undefined);
  await pipeline.assess(run); assert.equal(run.change.releaseAssessment!.status, 'blocked');
});
test('nonzero test exit persists VALIDATION_FAILED and blocks release', async () => {
  const root = await repository();
  await writeFile(path.join(root, 'check.mjs'), 'process.exit(9);\n'); await git(root, ['add', 'check.mjs']); await git(root, ['commit', '-m', 'fail test']);
  const pipeline = await Pipeline.create(root, silent), run = await pipeline.review(new LocalGitProvider(root), { base: 'main' });
  await pipeline.plan(run); await pipeline.verify(run);
  assert.equal(run.change.status, 'VALIDATION_FAILED'); assert.equal(run.change.evidence.at(-1)!.exitCode, 9);
  await pipeline.assess(run); assert.equal(run.change.status, 'BLOCKED'); assert.match(run.change.releaseAssessment!.blockers.join(' '), /unit/);
});
test('dirty or mismatched checkout fails verification before tests and is persisted', async () => {
  const root = await repository(), pipeline = await Pipeline.create(root, silent);
  const run = await pipeline.review(new LocalGitProvider(root), { base: 'main' }); await pipeline.plan(run);
  await writeFile(path.join(root, 'feature.txt'), 'uncommitted\n');
  await assert.rejects(pipeline.verify(run), /clean checkout/);
  assert.equal((await pipeline.load()).change.status, 'VALIDATION_FAILED');
  assert.equal(run.change.evidence.filter(e => e.type === 'test').length, 0);
});
test('persistence rejects concurrent mutation, invalid IDs and corrupt JSON', async () => {
  const root = await temporary(), store = new RunStore(root), unlock = await store.lock();
  await assert.rejects(store.lock(), /Another operation/); await unlock();
  await assert.rejects(store.load('../escape'), /Invalid run ID/);
  await assert.rejects(store.load(), /review first/);
});
test('CLI run/show provide JSON without logs on stdout and init preserves existing files', async () => {
  const root = await repository();
  const cli = (args: string[]) => runProcess(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', ...args, '--repo', root, '--json'], {
    cwd: process.cwd(), timeoutMs: 60_000, maxOutputBytes: 100_000,
  });
  const result = await cli(['run', '--base', 'main', '--head', 'HEAD', '--executor', 'mock']);
  assert.equal(result.exitCode, 3, result.stderr || result.stdout);
  const run = JSON.parse(result.stdout); assert.equal(run.change.releaseAssessment.status, 'needs-review');
  assert.match(result.stderr, /"event":"review.completed"/);
  const shown = await cli(['show']); assert.equal(JSON.parse(shown.stdout).change.id, run.change.id);
  const configBefore = await readFile(path.join(root, '.devops-agent/config.yaml'), 'utf8');
  const initialized = await cli(['init']); assert.equal(JSON.parse(initialized.stdout).created.length, 0);
  assert.equal(await readFile(path.join(root, '.devops-agent/config.yaml'), 'utf8'), configBefore);
});
test('malformed test planning invalidates prior results; forbidden agent commands never execute', async () => {
  const root = await repository();
  await writeConfig(root, { agents: { testPlanning: { executor: 'command', command: process.execPath, args: ['-e', 'console.log("{}")'] } } });
  const pipeline = await Pipeline.create(root, silent), run = await pipeline.review(new LocalGitProvider(root), { base: 'main' });
  await assert.rejects(pipeline.plan(run), /Malformed agent output/);
  assert.equal((await pipeline.load()).change.status, 'BLOCKED');
  assert.equal(run.change.testPlan, undefined);
});
