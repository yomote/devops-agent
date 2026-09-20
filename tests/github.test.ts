import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProvider } from '../packages/adapters/src/github.js';

const sha = 'a'.repeat(40), base = 'b'.repeat(40);
const meta = { number: 12, title: 'Fix', body: 'Details', html_url: 'https://github.com/owner/repo/pull/12', changed_files: 101, head: { sha }, base: { sha: base } };
const file = (i: number) => ({ filename: `src/${i}.ts`, status: 'modified', additions: 1, deletions: 1 });
test('GitHub reads PR metadata, bounded diff and all paginated files, caching one snapshot', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (url, options) => {
    calls.push(String(url));
    const headers = options?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer fixture-token');
    if (headers.Accept === 'application/vnd.github.diff') return new Response('diff --git a/file b/file');
    if (new URL(String(url)).searchParams.get('page') === '1') return Response.json(Array.from({ length: 100 }, (_, i) => file(i)));
    if (new URL(String(url)).searchParams.get('page') === '2') return Response.json([file(100)]);
    return Response.json(meta);
  };
  const provider = new GitHubProvider({ repository: 'owner/repo', root: process.cwd(), token: 'fixture-token', fetch: fakeFetch });
  const ref = { pullRequest: 12 };
  const [source, diff, files] = await Promise.all([provider.getChange(ref), provider.getDiff(ref), provider.getChangedFiles(ref)]);
  assert.equal(source.sourceRevision, sha); assert.equal(source.title, 'Fix'); assert.equal(files.length, 101);
  assert.match(diff.text, /diff --git/); assert.equal(calls.length, 5);
});
test('GitHub refuses API failures, >3000 files, incomplete responses and moving PRs', async () => {
  const make = (fetch: typeof globalThis.fetch) => new GitHubProvider({ repository: 'owner/repo', root: '.', fetch });
  await assert.rejects(make(async () => new Response('', { status: 403 })).getChange({ pullRequest: 12 }), /HTTP 403/);
  await assert.rejects(make(async () => Response.json({ ...meta, changed_files: 3001 })).getChange({ pullRequest: 12 }), /3000-file/);
  for (const moving of [false, true]) {
    let metadataCalls = 0;
    const fakeFetch: typeof fetch = async (url, options) => {
      if ((options?.headers as Record<string, string>).Accept?.endsWith('.diff')) return new Response('diff');
      if (String(url).includes('/files?')) return Response.json(moving ? [file(1)] : []);
      metadataCalls++;
      return Response.json({ ...meta, changed_files: 1, head: { sha: moving && metadataCalls === 2 ? base : sha } });
    };
    await assert.rejects(make(fakeFetch).getChange({ pullRequest: 12 }), moving ? /changed during/ : /incomplete/);
  }
});
