import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { ConfigSchema, ReleasePolicySchema, ReviewPolicySchema, TestingPolicySchema } from './schema.js';
import { packageRoot } from '../../platform/src/package.js';
export * from './schema.js';

async function optionalText(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function loadConfig(root: string) {
  const directory = path.join(root, '.devops-agent');
  const text = await readFile(path.join(directory, 'config.yaml'), 'utf8');
  const raw = parse(text) as unknown;
  const config = ConfigSchema.parse(raw);
  const [review, testing, release, instructions] = await Promise.all([
    optionalText(path.join(directory, 'policies', 'review.yaml')),
    optionalText(path.join(directory, 'policies', 'testing.yaml')),
    optionalText(path.join(directory, 'policies', 'release.yaml')),
    optionalText(path.join(directory, 'instructions', 'repository.md')),
  ]);
  // Optional policy files are defaults. Explicit inline values override them.
  const inline = raw as { policies?: { release?: object }; testing?: object };
  const releaseDefaults = release === undefined ? {} : ReleasePolicySchema.partial().parse(parse(release));
  const testingDefaults = testing === undefined ? {} : TestingPolicySchema.partial().parse(parse(testing));
  config.policies.release = ReleasePolicySchema.parse({ ...releaseDefaults, ...inline.policies?.release });
  config.testing = ConfigSchema.parse({ ...config, testing: { ...config.testing, ...testingDefaults, ...inline.testing } }).testing;
  return {
    config, instructions: instructions ?? '',
    reviewPolicy: ReviewPolicySchema.parse(review === undefined ? {} : parse(review)),
  };
}
export async function initRepository(root: string, preset?: 'tech-playground'): Promise<{ created: string[]; skipped: string[] }> {
  const config = {
    version: 1, project: { name: path.basename(root) }, provider: { type: 'local-git' },
    lifecycle: { review: true, testPlanning: true, testExecution: true, releaseAssurance: true },
    agents: { review: { executor: 'mock' }, testPlanning: { executor: 'mock' } },
    testing: { discovery: { mode: 'automatic' }, commands: [] },
  };
  const files: Record<string, string> = {
    'config.yaml': '# Register exact test commands here before verify. Mock is not a real code review.\n' + stringify(config),
    'policies/review.yaml': stringify(ReviewPolicySchema.parse({})),
    'policies/testing.yaml': stringify(TestingPolicySchema.parse({})),
    'policies/release.yaml': stringify(ReleasePolicySchema.parse({})),
    'instructions/repository.md': '# Repository Notes\n\nDescribe architecture, affected areas, security expectations, and validation requirements.\nRegister runnable tests with file patterns in config.yaml under testing.commands.\n',
    '.gitignore': 'runs/\n',
  };
  if (preset) {
    if (preset !== 'tech-playground') throw new Error(`Unknown preset: ${preset}`);
    for (const relative of Object.keys(files).filter(file => file !== '.gitignore')) {
      files[relative] = await readFile(path.join(packageRoot, 'examples', preset, '.devops-agent', relative), 'utf8');
    }
  }
  const result: { created: string[]; skipped: string[] } = { created: [], skipped: [] };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, '.devops-agent', relative);
    await mkdir(path.dirname(file), { recursive: true });
    try { await writeFile(file, contents, { flag: 'wx' }); result.created.push(relative); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; result.skipped.push(relative); }
  }
  return result;
}
