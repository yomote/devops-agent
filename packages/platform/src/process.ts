import { spawn } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
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
// Windows cmd/bat shims are deliberately refused; configure an exe or node + JS entry point.
async function resolveExecutable(command: string): Promise<string> {
  if (/\.(cmd|bat|ps1)$/i.test(command)) throw new Error('Shell scripts are not supported; use an executable or node with a JS entry point');
  if (path.isAbsolute(command)) { await access(command); return command; }
  if (command.includes('/') || command.includes('\\')) throw new Error('Executable must be an absolute path or a PATH name');
  const extensions = process.platform === 'win32' ? (path.extname(command) ? [''] : ['.exe', '.com']) : [''];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(p => path.isAbsolute(p))) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try { await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate; } catch { /* next */ }
    }
  }
  throw new Error(`Executable not found: ${command}. On Windows use an .exe shim or node with the package CLI's JS path.`);
}
export async function runProcess(command: string, args: readonly string[], options: {
  cwd: string; timeoutMs: number; maxOutputBytes: number; stdin?: string; env?: NodeJS.ProcessEnv;
}): Promise<ProcessResult> {
  const executable = await resolveExecutable(command);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
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
