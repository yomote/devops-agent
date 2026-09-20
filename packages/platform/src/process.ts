import { spawn } from 'node:child_process';
import { access, realpath, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export interface ProcessResult {
  stdout: string; stderr: string; exitCode: number | null; durationMs: number;
  timedOut: boolean; outputLimitExceeded: boolean;
}
export function parseCommand(command: string): string[] {
  if (/[;&|<>`$%!\r\n\0]/.test(command)) throw new Error('Shell operators, expansion and control characters are prohibited');
  const args: string[] = [];
  let word = '', quote = '', active = false;
  for (const char of command) {
    if (quote) { if (char === quote) quote = ''; else word += char; active = true; }
    else if (char === '"' || char === "'") { quote = char; active = true; }
    else if (/\s/.test(char)) { if (active) { args.push(word); word = ''; active = false; } }
    else { word += char; active = true; }
  }
  if (quote) throw new Error('Unterminated command quote');
  if (active) args.push(word);
  if (!args[0]) throw new Error('Empty executable');
  return args;
}
export async function containedDirectory(root: string, directory: string): Promise<string> {
  if (path.isAbsolute(directory)) throw new Error('Working directory must be repository-relative');
  const canonicalRoot = await realpath(root);
  const candidate = await realpath(path.resolve(canonicalRoot, directory));
  const relative = path.relative(canonicalRoot, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('Working directory escapes repository (including symlinks)');
  return candidate;
}
// Resolve executables from PATH, never implicitly from the repository cwd.
// Known package-manager cmd shims are mapped to the installed package's Node bin.
// The cmd file itself is never interpreted or executed.
export async function resolveInvocation(command: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<{ executable: string; prefix: string[] }> {
  if (/\.(cmd|bat|ps1)$/i.test(command)) throw new Error('Shell scripts are not supported; use an executable or node with a JS entry point');
  if (path.isAbsolute(command)) { await access(command); return { executable: command, prefix: [] }; }
  if (command.includes('/') || command.includes('\\')) throw new Error('Executable must be an absolute path or a PATH name');
  const extensions = platform === 'win32' ? (path.extname(command) ? [''] : ['.exe', '.com']) : [''];
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of searchPath.split(path.delimiter).filter(p => path.isAbsolute(p))) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return { executable: candidate, prefix: [] }; } catch { /* next */ }
    }
    if (platform === 'win32' && ['npm', 'npx', 'pnpm'].includes(command)) {
      try { await access(path.join(directory, `${command}.cmd`)); } catch { continue; }
      for (const name of [command === 'pnpm' ? 'pnpm' : 'npm', 'corepack']) {
        const candidates = [path.join(directory, 'node_modules', name)];
        if (path.basename(directory) === '.bin') candidates.push(path.resolve(directory, '..', name));
        for (const candidate of candidates) {
          try {
            const root = await realpath(candidate);
            const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
            const bin = typeof metadata.bin === 'string' && metadata.name === command ? metadata.bin : metadata.bin?.[command];
            if (metadata.name !== name || typeof bin !== 'string' || !/\.(c?js|mjs)$/.test(bin)) continue;
            const entry = await realpath(path.resolve(root, bin));
            const relative = path.relative(root, entry);
            if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) continue;
            return { executable: process.execPath, prefix: [entry] };
          } catch { /* not a supported installed Node package */ }
        }
      }
    }
  }
  throw new Error(`Executable not found: ${command}. On Windows use an .exe shim or node with the package CLI's JS path.`);
}
export async function runProcess(command: string, args: readonly string[], options: {
  cwd: string; timeoutMs: number; maxOutputBytes: number; stdin?: string; env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  const invocation = await resolveInvocation(command, options.env);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, [...invocation.prefix, ...args], {
      cwd: options.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'], env: options.env ?? process.env,
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, timedOut = false, outputLimitExceeded = false, stopped = false, settled = false;
    let fallback: NodeJS.Timeout | undefined;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); if (fallback) clearTimeout(fallback);
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode, durationMs: Date.now() - start, timedOut, outputLimitExceeded });
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (child.pid) {
        if (process.platform === 'win32') {
          const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', shell: false });
          killer.on('error', () => child.kill('SIGKILL'));
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }
      fallback = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(null); }, 2_000);
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      const remaining = Math.max(0, options.maxOutputBytes - bytes);
      target.push(chunk.subarray(0, remaining)); bytes += chunk.length;
      if (bytes > options.maxOutputBytes) { outputLimitExceeded = true; stop(); }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
    child.stdout.on('data', chunk => collect(stdout, chunk));
    child.stderr.on('data', chunk => collect(stderr, chunk));
    child.stdin.on('error', () => { /* early process exit / EPIPE */ });
    child.on('error', error => { clearTimeout(timer); if (fallback) clearTimeout(fallback); settled = true; reject(error); });
    child.on('close', finish);
    child.stdin.end(options.stdin);
  });
}
export function testEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY|GITHUB|GH_|AZURE|AWS_/i.test(key)));
}
