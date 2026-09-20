import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { git } from '../packages/adapters/src/local-git.js';
import { initRepository, ConfigSchema } from '../packages/config/src/index.js';
import { ChangeSchema, type EventLogger } from '../packages/core/src/index.js';

export const silent: EventLogger = { emit() {} };
export async function temporary() { return mkdtemp(path.join(os.tmpdir(), 'devops-agent-test-')); }
export const command = `"${process.execPath}" check.mjs`;
export async function repository() {
  const root = await temporary();
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'DevOps Agent Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(path.join(root, '.gitignore'), '.devops-agent/runs/\n');
  await writeFile(path.join(root, 'check.mjs'), "console.log('validation passed');\n");
  await writeFile(path.join(root, 'feature.txt'), 'before\n');
  await git(root, ['add', '.']); await git(root, ['commit', '-m', 'base']);
  await git(root, ['checkout', '-b', 'feature']);
  await writeFile(path.join(root, 'feature.txt'), 'after\n');
  await git(root, ['add', '.']); await git(root, ['commit', '-m', 'change']);
  await initRepository(root);
  await writeConfig(root);
  return root;
}
export async function writeConfig(root: string, overrides: Record<string, unknown> = {}) {
  const config = { version: 1, project: { name: 'test' }, testing: {
    allowedCommands: [process.execPath], commands: [{ id: 'unit', type: 'unit', command, description: 'Unit tests', required: true, files: ['**/*'] }],
  }, ...overrides };
  await mkdir(path.join(root, '.devops-agent'), { recursive: true });
  await writeFile(path.join(root, '.devops-agent', 'config.yaml'), stringify(config));
  return ConfigSchema.parse(config);
}
export function change() { return ChangeSchema.parse({
  id: 'example', repository: { provider: 'local-git', name: 'repo', root: process.cwd() },
  sourceRevision: 'head-sha', targetRevision: 'base-sha', files: [], status: 'CREATED', risks: [], findings: [], evidence: [],
}); }
