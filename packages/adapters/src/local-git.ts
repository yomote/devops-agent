import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeRef, ChangeSource, ChangedFile, Diff, SourceControlProvider } from '../../core/src/index.js';
import { runProcess } from '../../platform/src/process.js';

export async function git(root: string, args: string[]): Promise<string> {
  const result = await runProcess('git', args, { cwd: root, timeoutMs: 30_000, maxOutputBytes: 10_000_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } });
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded)
    throw new Error(`git ${args[0]} failed${result.outputLimitExceeded ? ' (output limit)' : ''}: ${result.stderr.trim()}`);
  return result.stdout;
}
export async function resolveRevision(root: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith('-') || /[\0\r\n]/.test(ref)) throw new Error('Invalid Git revision');
  return (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}
export class LocalGitProvider implements SourceControlProvider {
  constructor(private readonly root: string) {}
  private snapshots = new Map<string, Promise<{ source: ChangeSource; diff: Diff; files: ChangedFile[] }>>();
  private snapshot(ref: ChangeRef) {
    const key = JSON.stringify(ref);
    let existing = this.snapshots.get(key);
    if (!existing) { existing = this.read(ref); this.snapshots.set(key, existing); }
    return existing;
  }
  private async read(ref: ChangeRef) {
    const root = await realpath(this.root);
    const top = await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim());
    if (root !== top) throw new Error('Use the Git repository root with --repo');
    const base = await resolveRevision(root, ref.base ?? 'main');
    const head = await resolveRevision(root, ref.head ?? 'HEAD');
    const mergeBase = (await git(root, ['merge-base', base, head])).trim();
    const [text, names] = await Promise.all([
      git(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', mergeBase, head, '--']),
      git(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', mergeBase, head, '--']),
    ]);
    const parts = names.split('\0');
    const files: ChangedFile[] = [];
    while (parts[0]) {
      const code = parts.shift()!;
      const first = parts.shift()!;
      const map: Record<string, ChangedFile['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged', T: 'modified' };
      if (code.startsWith('R') || code.startsWith('C')) files.push({ path: parts.shift()!, previousPath: first, status: map[code[0]!]! });
      else files.push({ path: first, status: map[code[0]!] ?? 'unknown' });
    }
    const digest = createHash('sha256').update(`${root}\0${base}\0${head}`).digest('hex').slice(0, 20);
    const source: ChangeSource = {
      id: `local-${digest}`, repository: { provider: 'local-git', name: path.basename(root), root },
      sourceRevision: head, targetRevision: base, title: `local/${ref.base ?? 'main'}...${ref.head ?? 'HEAD'}`,
    };
    return { source, diff: { text, baseRevision: mergeBase, headRevision: head }, files };
  }
  async getChange(ref: ChangeRef) { return (await this.snapshot(ref)).source; }
  async getDiff(ref: ChangeRef) { return (await this.snapshot(ref)).diff; }
  async getChangedFiles(ref: ChangeRef) { return (await this.snapshot(ref)).files; }
}
export async function assertCheckout(root: string, revision: string): Promise<void> {
  if (await resolveRevision(root, 'HEAD') !== revision) throw new Error('Checkout HEAD differs from Change sourceRevision; checkout the reviewed commit before verify');
  const dirty = await git(root, ['status', '--porcelain', '--untracked-files=normal', '--', '.', ':(exclude).devops-agent']);
  if (dirty.trim()) throw new Error('Verification requires a clean checkout (except .devops-agent configuration); commit or stash changes first');
}
