import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCommand, containedDirectory, runProcess, testEnvironment } from '../packages/platform/src/process.js';
import { CommandAgentExecutor, MockAgentExecutor, type AgentContext } from '../packages/agent-runtime/src/index.js';
import { ReviewResultSchema, TestPlanSchema } from '../packages/core/src/index.js';
import { executeTest } from '../packages/application/src/execution.js';
import { temporary, repository, writeConfig, command, change, silent } from './helpers.js';

test('command tokenizer supports quoted arguments and refuses shell operators', () => {
  assert.deepEqual(parseCommand('pnpm --filter "demo name" test'), ['pnpm', '--filter', 'demo name', 'test']);
  for (const value of ['pnpm test && whoami', 'pnpm test;whoami', 'node $(whoami)', 'echo %PATH%', 'pnpm test > file', 'pnpm "test']) assert.throws(() => parseCommand(value));
});
test('cwd rejects traversal and symlink escape', async () => {
  const root = await temporary(), outside = await temporary();
  await mkdir(path.join(root, 'safe'));
  assert.equal(await containedDirectory(root, 'safe'), path.join(root, 'safe'));
  await assert.rejects(containedDirectory(root, '../'), /escapes/);
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(containedDirectory(root, 'escape'), /escapes/);
  await assert.rejects(containedDirectory(root, outside), /relative/);
});
test('process captures stdout, stderr and exit codes without a shell', async () => {
  const result = await runProcess(process.execPath, ['-e', "console.log('out');console.error('err');process.exit(7)"], { cwd: process.cwd(), timeoutMs: 5_000, maxOutputBytes: 1024 });
  assert.equal(result.exitCode, 7); assert.match(result.stdout, /out/); assert.match(result.stderr, /err/);
});
test('process enforces timeout and bounded output', async () => {
  const opts = { cwd: process.cwd(), timeoutMs: 200, maxOutputBytes: 256 };
  const timeout = await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], opts);
  assert.equal(timeout.timedOut, true);
  const flood = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { ...opts, timeoutMs: 5_000 });
  assert.equal(flood.outputLimitExceeded, true); assert.ok(Buffer.byteLength(flood.stdout) <= 256);
});
test('test executor requires exact registered command and records denied executions', async () => {
  const root = await repository(), config = await writeConfig(root), item = change(); item.repository.root = root;
  const planned = { id: 'unit', type: 'unit' as const, command, cwd: '.', description: 'x', reason: 'y', required: true };
  assert.equal((await executeTest(planned, item, config, silent)).status, 'passed');
  const denied = await executeTest({ ...planned, command: `${command} --extra` }, item, config, silent);
  assert.equal(denied.status, 'failed'); assert.match(denied.summary, /Denied/);
  config.testing.allowedCommands = [];
  assert.match((await executeTest(planned, item, config, silent)).summary, /allowedCommands/);
  assert.equal((await executeTest({ ...planned, command: undefined }, item, config, silent)).status, 'unknown');
});
test('mock outputs validate and malformed fixture fails', async () => {
  const context: AgentContext = { change: change(), diff: { text: '', baseRevision: 'a', headRevision: 'b' }, repositoryInstructions: 'notes', reviewFocus: [], candidateTests: [] };
  const mock = new MockAgentExecutor();
  const fixture = JSON.parse(await readFile(new URL('./fixtures/review.json', import.meta.url), 'utf8'));
  assert.equal((await new MockAgentExecutor({ review: fixture }).execute({ kind: 'review', input: context, outputSchema: ReviewResultSchema })).risks[0]!.area, 'security');
  assert.match((await mock.execute({ kind: 'review', input: context, outputSchema: ReviewResultSchema })).summary, /MOCK/);
  assert.deepEqual((await mock.execute({ kind: 'test-planning', input: context, outputSchema: TestPlanSchema })).tests, []);
  await assert.rejects(new MockAgentExecutor({ review: { summary: 'invalid' } }).execute({ kind: 'review', input: context, outputSchema: ReviewResultSchema }));
});
test('command agent uses JSON stdin/stdout and validates every response', async () => {
  const options = { command: process.execPath, cwd: process.cwd(), timeoutMs: 5_000, maxOutputBytes: 10_000 };
  const script = 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.stringify({summary:JSON.parse(s).input.note,risks:[],findings:[]})))';
  const task = { kind: 'review' as const, input: { note: 'received context' }, outputSchema: ReviewResultSchema };
  assert.equal((await new CommandAgentExecutor({ ...options, args: ['-e', script] }).execute(task)).summary, 'received context');
  for (const script of ['console.log("not-json")', 'console.log("{}")', 'console.log("{}\\n{}")']) {
    await assert.rejects(new CommandAgentExecutor({ ...options, args: ['-e', script] }).execute(task), /Malformed agent output/);
  }
  await assert.rejects(new CommandAgentExecutor({ ...options, args: ['-e', 'process.exit(3)'] }).execute(task), /Agent command failed/);
});
test('test environment removes common credentials', () => {
  process.env.DEVOPS_TEST_API_KEY = 'not-a-real-secret';
  assert.equal(testEnvironment().DEVOPS_TEST_API_KEY, undefined);
  delete process.env.DEVOPS_TEST_API_KEY;
});
