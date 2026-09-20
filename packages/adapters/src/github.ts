import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ChangeRef, ChangeSource, ChangedFile, Diff, SourceControlProvider } from '../../core/src/index.js';

const metadataSchema = z.object({
  number: z.number().int().positive(), title: z.string(), body: z.string().nullable(), html_url: z.string().url(),
  changed_files: z.number().int().nonnegative(), head: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/) }),
  base: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/) }),
});
const filesSchema = z.array(z.object({ filename: z.string(), previous_filename: z.string().optional(),
  status: z.string(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative() }));
export class GitHubProvider implements SourceControlProvider {
  private snapshots = new Map<number, Promise<{ source: ChangeSource; diff: Diff; files: ChangedFile[] }>>();
  constructor(private readonly options: { repository: string; root: string; token?: string; fetch?: typeof fetch }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository)) throw new Error('GitHub repository must be owner/name');
  }
  private async request(endpoint: string, accept = 'application/vnd.github+json'): Promise<string> {
    const response = await (this.options.fetch ?? fetch)(`https://api.github.com/repos/${this.options.repository}${endpoint}`, {
      headers: { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'devops-agent/0.1',
        ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}) },
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub request failed: HTTP ${response.status} (${endpoint}); check access, token permissions or rate limits`); }
    if (!response.body) throw new Error('GitHub returned an empty response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 10_000_000) throw new Error('GitHub response exceeded output limit');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks).toString('utf8');
  }
  private snapshot(ref: ChangeRef) {
    const number = ref.pullRequest;
    if (!number || !Number.isSafeInteger(number) || number < 1) throw new Error('GitHub provider requires a positive --pr number');
    let result = this.snapshots.get(number);
    if (!result) { result = this.read(number); this.snapshots.set(number, result); }
    return result;
  }
  private async read(number: number) {
    const endpoint = `/pulls/${number}`;
    const before = metadataSchema.parse(JSON.parse(await this.request(endpoint)));
    if (before.changed_files > 3000) throw new Error('GitHub PR exceeds the 3000-file API limit; use local-git for complete review');
    const text = await this.request(endpoint, 'application/vnd.github.diff');
    const files: ChangedFile[] = [];
    for (let page = 1; page <= Math.max(1, Math.ceil(before.changed_files / 100)); page++) {
      const entries = filesSchema.parse(JSON.parse(await this.request(`${endpoint}/files?per_page=100&page=${page}`)));
      const status: Record<string, ChangedFile['status']> = { added: 'added', removed: 'deleted', modified: 'modified', renamed: 'renamed', copied: 'copied', changed: 'modified' };
      files.push(...entries.map(file => ({ path: file.filename, previousPath: file.previous_filename,
        status: status[file.status] ?? 'unknown', additions: file.additions, deletions: file.deletions })));
    }
    const after = metadataSchema.parse(JSON.parse(await this.request(endpoint)));
    if (before.head.sha !== after.head.sha || before.base.sha !== after.base.sha || before.changed_files !== after.changed_files)
      throw new Error('PR changed during retrieval; retry to obtain a consistent snapshot');
    if (files.length !== before.changed_files || new Set(files.map(f => f.path)).size !== files.length)
      throw new Error('GitHub returned an incomplete changed-file list');
    const key = createHash('sha256').update(`${this.options.repository}\0${before.base.sha}\0${before.head.sha}`).digest('hex').slice(0, 20);
    const source: ChangeSource = { id: `github-${number}-${key}`,
      repository: { provider: 'github', name: this.options.repository, root: this.options.root, url: `https://github.com/${this.options.repository}` },
      sourceRevision: before.head.sha, targetRevision: before.base.sha, title: before.title, description: before.body ?? '' };
    return { source, diff: { text, baseRevision: before.base.sha, headRevision: before.head.sha }, files };
  }
  async getChange(ref: ChangeRef) { return (await this.snapshot(ref)).source; }
  async getDiff(ref: ChangeRef) { return (await this.snapshot(ref)).diff; }
  async getChangedFiles(ref: ChangeRef) { return (await this.snapshot(ref)).files; }
}
