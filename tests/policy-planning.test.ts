import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRelease, ReleasePolicySchema, affectedTests, enforceRequiredTests, TestPlanSchema, type CatalogEntry } from '../packages/core/src/index.js';
import { change } from './helpers.js';

const registered: CatalogEntry = { id: 'unit', type: 'unit', command: 'pnpm test', cwd: '.', description: 'Unit', required: true, files: ['demos/auth/**'], always: false };
function assessedChange() {
  const item = change(); item.testPlan = TestPlanSchema.parse({ rationale: 'Validate', tests: [{ ...registered, reason: 'affected', files: undefined, always: undefined }].map(({ files, always, ...test }) => test) });
  item.evidence = [{ id: 'e', type: 'test', source: 'test', status: 'passed', summary: 'pass', testId: 'unit',
    command: 'pnpm test', cwd: '.', sourceRevision: item.sourceRevision, targetRevision: item.targetRevision }];
  return item;
}
const context = { reviewCompleted: true, mockUsed: false };
test('ready requires matching evidence; mock produces needs-review', () => {
  const item = assessedChange(), policy = ReleasePolicySchema.parse({});
  assert.equal(assessRelease(item, policy, context).status, 'ready');
  assert.equal(assessRelease(item, policy, { ...context, mockUsed: true }).status, 'needs-review');
  item.evidence[0]!.sourceRevision = 'stale';
  assert.equal(assessRelease(item, policy, context).status, 'blocked');
});
test('policy blocks critical findings, risks, failed/missing required tests and unapproved changes', () => {
  const item = assessedChange();
  item.findings.push({ id: 'f', severity: 'critical', category: 'security', title: 'Injection', description: 'Unsafe input' });
  item.risks.push({ id: 'r', severity: 'critical', area: 'data', description: 'Destructive migration' });
  item.evidence[0]!.status = 'failed';
  const policy = ReleasePolicySchema.parse({ requireHumanApproval: true });
  assert.equal(assessRelease(item, policy, context).blockers.length, 4);
  assert.equal(assessRelease(change(), policy, { reviewCompleted: false, mockUsed: false }).status, 'blocked');
});
test('approval is revision-bound and policy can waive test gate explicitly', () => {
  const item = assessedChange(), policy = ReleasePolicySchema.parse({ requireHumanApproval: true });
  assert.equal(assessRelease(item, policy, { ...context, humanApproval: { approver: 'operator', sourceRevision: item.sourceRevision, targetRevision: item.targetRevision } }).status, 'ready');
  assert.equal(assessRelease(item, policy, { ...context, humanApproval: { approver: 'operator', sourceRevision: 'old', targetRevision: item.targetRevision } }).status, 'blocked');
  item.evidence = [];
  assert.equal(assessRelease(item, ReleasePolicySchema.parse({ requireAllRequiredTests: false }), context).status, 'needs-review');
});
test('affected patterns include renamed previous paths and always checks', () => {
  const all = { ...registered, id: 'root', always: true, files: [] };
  assert.deepEqual(affectedTests([{ path: 'demos/other/new.ts', previousPath: 'demos/auth/old.ts', status: 'renamed' }], [registered, all]).map(t => t.id), ['unit', 'root']);
  assert.deepEqual(affectedTests([{ path: 'docs/readme.md', status: 'modified' }], [registered, all]).map(t => t.id), ['root']);
});
test('agent cannot omit, downgrade or rewrite configured required checks', () => {
  const result = enforceRequiredTests({ rationale: 'r', tests: [] }, [registered]);
  assert.equal(result.tests[0]!.required, true);
  result.tests[0]!.required = false;
  assert.equal(enforceRequiredTests(result, [registered]).tests[0]!.required, true);
  result.tests[0]!.command = 'pnpm exec evil';
  assert.throws(() => enforceRequiredTests(result, [registered]), /altered/);
  assert.equal(enforceRequiredTests({ rationale: 'r', tests: [] }, []).tests[0]!.command, undefined);
});
