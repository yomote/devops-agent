import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../dist/packages/platform/src/process.js';

const project = await mkdtemp(path.join(os.tmpdir(), 'devops-agent-package-'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tarball = path.resolve(process.argv[2] ?? `.artifacts/devops-agent-${manifest.version}.tgz`);
await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'portable-consumer', version: '1.0.0', private: true }));
async function invoke(command, args, cwd = project, expected = 0) {
  const result = await runProcess(command, args, { cwd, timeoutMs: 120000, maxOutputBytes: 200000 });
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.outputLimitExceeded, false);
  assert.equal(result.exitCode, expected, result.stderr || result.stdout);
  return result.stdout;
}
// Reuse the package manager that started this script. Some pnpm environments
// intentionally provide Node and pnpm without installing npm on PATH.
const managerEntry = process.env.npm_execpath;
const pnpm = (process.env.npm_config_user_agent ?? 'pnpm/').startsWith('pnpm/');
const managerCommand = managerEntry && /\.(?:c?js|mjs)$/.test(managerEntry) ? process.execPath : managerEntry ?? 'pnpm';
const managerPrefix = managerCommand === process.execPath && managerEntry ? [managerEntry] : [];
const manager = args => invoke(managerCommand, [...managerPrefix, ...args]);
await manager(pnpm ? ['add', '--ignore-scripts', '--save-dev', tarball] : ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', tarball]);
const version = await manager(pnpm ? ['exec', 'devops-agent', '--version'] : ['exec', '--offline', '--', 'devops-agent', '--version']);
assert.equal(version.trim(), manifest.version);
const repo = path.join(project, 'fixture'); await mkdir(repo);
const cli = path.join(project, 'node_modules/devops-agent/dist/packages/cli/src/index.js');
const init = JSON.parse(await invoke(process.execPath, [cli, 'init', '--preset', 'tech-playground', '--repo', repo, '--json']));
assert.equal(init.created.length, 6);
assert.ok((await readdir(path.join(repo, '.devops-agent/policies'))).includes('testing.yaml'));

// Validate an installed package against a separate Git checkout, outside the source tree.
await invoke('git', ['init', '-b', 'main'], repo);
await invoke('git', ['config', 'user.name', 'Package Smoke'], repo);
await invoke('git', ['config', 'user.email', 'smoke@example.invalid'], repo);
await writeFile(path.join(repo, 'check.mjs'), 'console.log("portable test passed")');
await writeFile(path.join(repo, 'change.txt'), 'base\n');
await invoke('git', ['add', '.'], repo); await invoke('git', ['commit', '-m', 'base'], repo);
await invoke('git', ['checkout', '-b', 'change'], repo);
await writeFile(path.join(repo, 'change.txt'), 'head\n');
await invoke('git', ['add', 'change.txt'], repo); await invoke('git', ['commit', '-m', 'change'], repo);
await writeFile(path.join(repo, '.devops-agent/config.yaml'), JSON.stringify({ version: 1, project: { name: 'portable' },
  testing: { allowedCommands: ['node'], commands: [{ id: 'smoke', type: 'smoke', command: 'node check.mjs', description: 'Portable process test', required: true }] } }));
const run = JSON.parse(await invoke(process.execPath, [cli, 'run', '--repo', repo, '--base', 'main', '--executor', 'mock', '--json'], project, 3));
assert.equal(run.change.releaseAssessment.status, 'needs-review');
assert.equal(run.change.evidence.find(e => e.testId === 'smoke').status, 'passed');
console.log(`Installed package ${manifest.version}: bin, preset and full lifecycle passed (${process.platform}).`);
