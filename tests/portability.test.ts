import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { resolveInvocation, runProcess } from '../packages/platform/src/process.js';
import { initRepository, loadConfig } from '../packages/config/src/index.js';
import { affectedTests } from '../packages/core/src/index.js';
import { temporary } from './helpers.js';

test('Windows package-manager shims use a validated Node entry point without executing cmd', async () => {
  const root = await temporary(), bin = path.join(root, 'node_modules/pnpm/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(root, 'pnpm.cmd'), '@echo UNSAFE_SHIM_MUST_NOT_RUN');
  await writeFile(path.join(root, 'node_modules/pnpm/package.json'), JSON.stringify({ name: 'pnpm', bin: { pnpm: 'bin/pnpm.cjs' } }));
  const entry = path.join(bin, 'pnpm.cjs');
  await writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const env = { PATH: root };
  const invocation = await resolveInvocation('pnpm', env, 'win32');
  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.prefix, [await realpath(entry)]);
  const result = await runProcess(invocation.executable, [...invocation.prefix, 'test', 'argument with spaces'], { cwd: root, timeoutMs: 5000, maxOutputBytes: 1024 });
  assert.deepEqual(JSON.parse(result.stdout), ['test', 'argument with spaces']);
  await assert.rejects(resolveInvocation('pnpm.cmd', env, 'win32'), /Shell scripts/);
  await writeFile(path.join(root, 'evil.cmd'), 'echo denied');
  await assert.rejects(resolveInvocation('evil', env, 'win32'), /Executable not found/);
  await writeFile(path.join(root, 'outside.cjs'), 'throw new Error("must not run")');
  await writeFile(path.join(root, 'node_modules/pnpm/package.json'), JSON.stringify({ name: 'pnpm', bin: { pnpm: '../../outside.cjs' } }));
  await assert.rejects(resolveInvocation('pnpm', env, 'win32'), /Executable not found/);
});

test('Windows node_modules/.bin layout and Corepack proxies are supported', async () => {
  const root = await temporary(), bin = path.join(root, 'node_modules/.bin');
  const corepack = path.join(root, 'node_modules/corepack');
  await mkdir(bin, { recursive: true }); await mkdir(path.join(corepack, 'dist'), { recursive: true });
  await writeFile(path.join(bin, 'pnpm.cmd'), 'ignored shim');
  await writeFile(path.join(corepack, 'package.json'), JSON.stringify({ name: 'corepack', bin: { pnpm: './dist/pnpm.js' } }));
  await writeFile(path.join(corepack, 'dist/pnpm.js'), '// fixture');
  assert.deepEqual((await resolveInvocation('pnpm', { Path: bin }, 'win32')).prefix, [await realpath(path.join(corepack, 'dist/pnpm.js'))]);
});

test('installed preset generates a thin contract, preserves files and selects affected validation', async () => {
  const root = await temporary();
  assert.equal((await initRepository(root, 'tech-playground')).created.length, 6);
  const { config } = await loadConfig(root);
  assert.equal(config.project.name, 'tech-playground');
  assert.deepEqual(affectedTests([{ path: 'demos/openfga-sharing-playground/model.fga', status: 'modified' }], config.testing.commands).map(t => t.id),
    ['root-build', 'root-typecheck', 'root-metadata', 'openfga-authorization']);
  await writeFile(path.join(root, '.devops-agent/instructions/repository.md'), 'Keep local notes');
  assert.equal((await initRepository(root, 'tech-playground')).created.length, 0);
  assert.equal((await loadConfig(root)).instructions, 'Keep local notes');
});
