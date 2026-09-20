import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { ChangeSchema, ReviewResultSchema, TestPlanSchema, ReleaseAssessmentSchema, transition, canTransition } from '../packages/core/src/index.js';
import { ConfigSchema, initRepository, loadConfig } from '../packages/config/src/index.js';
import { change, temporary } from './helpers.js';

test('domain schemas reject unknown fields, bad enums and duplicate test IDs', () => {
  assert.equal(ChangeSchema.parse(change()).status, 'CREATED');
  assert.throws(() => ChangeSchema.parse({ ...change(), arbitrary: true }));
  assert.throws(() => ReviewResultSchema.parse({ summary: 'x', risks: [], findings: [{ severity: 'low' }] }));
  assert.throws(() => ReleaseAssessmentSchema.parse({ status: 'maybe', summary: 'x', blockers: [], warnings: [] }));
  const test = { id: 'a', type: 'unit', description: 'test', reason: 'risk', required: true };
  assert.throws(() => TestPlanSchema.parse({ rationale: 'r', tests: [test, test] }));
});
test('config rejects unknown fields at every level, malformed YAML and duplicate IDs', async () => {
  assert.equal(ConfigSchema.parse({ version: 1, project: { name: 'demo' } }).agents.review.executor, 'mock');
  assert.throws(() => ConfigSchema.parse({ version: 1, project: { name: 'demo', typo: true } }));
  assert.throws(() => ConfigSchema.parse({ version: 2, project: { name: 'demo' } }));
  assert.throws(() => ConfigSchema.parse({ version: 1, project: { name: 'demo' }, testing: { timeoutMs: 0 } }));
  const root = await temporary(); await initRepository(root);
  await writeFile(path.join(root, '.devops-agent/config.yaml'), 'version: [');
  await assert.rejects(loadConfig(root));
});
test('init is idempotent, does not overwrite and loads policy files', async () => {
  const root = await temporary();
  const first = await initRepository(root); assert.equal(first.created.length, 6);
  const note = path.join(root, '.devops-agent/instructions/repository.md'); await writeFile(note, '# Keep me');
  const second = await initRepository(root); assert.equal(second.created.length, 0); assert.equal(second.skipped.length, 6);
  assert.equal(await readFile(note, 'utf8'), '# Keep me');
  await writeFile(path.join(root, '.devops-agent/policies/release.yaml'), 'requireHumanApproval: true\n');
  assert.equal((await loadConfig(root)).config.policies.release.requireHumanApproval, true);
  await writeFile(path.join(root, '.devops-agent/config.yaml'), stringify({ version: 1, project: { name: 'x' }, policies: { release: { requireHumanApproval: false } } }));
  assert.equal((await loadConfig(root)).config.policies.release.requireHumanApproval, false);
  await writeFile(path.join(root, '.devops-agent/policies/testing.yaml'), 'allowdCommands: [node]\n');
  await assert.rejects(loadConfig(root), /Unrecognized key/);
});
test('core owns forward transitions and failure/retry rules', () => {
  const item = change();
  assert.throws(() => transition(item, 'VALIDATING'), /Invalid lifecycle/);
  for (const state of ['UNDER_REVIEW', 'REVIEWED', 'TEST_PLANNED', 'VALIDATING', 'VALIDATION_FAILED', 'VALIDATING', 'ASSESSED'] as const) transition(item, state);
  assert.equal(item.status, 'ASSESSED');
  assert.equal(canTransition('UNDER_REVIEW', 'REVIEW_FAILED'), true);
  assert.equal(canTransition('REVIEW_FAILED', 'VALIDATING'), false);
});
