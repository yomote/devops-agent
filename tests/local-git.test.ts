import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LocalGitProvider, git, assertCheckout, resolveRevision } from '../packages/adapters/src/local-git.js';
import { repository } from './helpers.js';

test('local provider pins SHA and loads triple-dot diff with changed files', async () => {
  const root = await repository(), provider = new LocalGitProvider(root), ref = { base: 'main', head: 'HEAD' };
  const source = await provider.getChange(ref);
  assert.equal(source.sourceRevision, await resolveRevision(root, 'HEAD'));
  assert.equal(source.targetRevision, await resolveRevision(root, 'main'));
  assert.match((await provider.getDiff(ref)).text, /\+after/);
  assert.deepEqual((await provider.getChangedFiles(ref)).map(f => f.path), ['feature.txt']);
  await assertCheckout(root, source.sourceRevision);
  await writeFile(path.join(root, 'feature.txt'), 'dirty');
  await assert.rejects(assertCheckout(root, source.sourceRevision), /clean checkout/);
  await assert.rejects(resolveRevision(root, '--help'), /Invalid Git revision/);
});
test('local provider handles rename paths and merge-base semantics', async () => {
  const root = await repository();
  await git(root, ['mv', 'feature.txt', 'renamed file.txt']); await git(root, ['commit', '-m', 'rename']);
  const provider = new LocalGitProvider(root);
  const files = await provider.getChangedFiles({ base: 'HEAD~1', head: 'HEAD' });
  assert.equal(files[0]!.status, 'renamed'); assert.equal(files[0]!.previousPath, 'feature.txt'); assert.equal(files[0]!.path, 'renamed file.txt');
  await git(root, ['checkout', 'main']); await writeFile(path.join(root, 'base-only.txt'), 'unrelated');
  await git(root, ['add', 'base-only.txt']); await git(root, ['commit', '-m', 'base advances']); await git(root, ['checkout', 'feature']);
  const diff = await new LocalGitProvider(root).getDiff({ base: 'main', head: 'HEAD' });
  assert.doesNotMatch(diff.text, /base-only/);
  assert.notEqual(diff.baseRevision, await resolveRevision(root, 'main'));
});
