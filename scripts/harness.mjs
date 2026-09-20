import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const mode = process.argv[2];

function packageManager() {
  // pnpm can run in an isolated runtime without npm or a global pnpm on PATH.
  // Reuse its actual entry point; never invoke a cmd/PowerShell shim or a shell.
  const entry = process.env.npm_execpath;
  if (!entry || !path.isAbsolute(entry) || !/^pnpm\//.test(process.env.npm_config_user_agent ?? '')) {
    throw new Error('Run this harness through pnpm: pnpm run doctor, pnpm check, or pnpm check:package.');
  }
  if (/\.(?:cmd|bat|ps1)$/i.test(entry)) throw new Error('pnpm must expose its executable or Node entry point in npm_execpath.');
  return /\.(?:c?js|mjs)$/i.test(entry)
    ? { command: process.execPath, prefix: [entry] }
    : { command: entry, prefix: [] };
}

function run(command, args, { capture = false, timeout = 600_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: root, shell: false, windowsHide: true,
    stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', timeout, maxBuffer: 1_000_000,
  });
  if (result.error) throw new Error(`Could not run ${path.basename(command)}: ${result.error.message}`);
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed (${result.signal ?? `exit ${result.status}`}).`);
  }
  return result.stdout?.trim() ?? '';
}

function step(label, action) {
  console.log(`\n[devops-agent] ${label}`);
  action();
}

try {
  if (!['check', 'check:package', 'doctor'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Usage: pnpm run doctor | pnpm check | pnpm check:package');
  }
  const manager = packageManager();
  const pnpm = args => run(manager.command, [...manager.prefix, ...args]);

  if (mode === 'doctor') {
    // No install, network calls, credentials, or repository mutations.
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(`Node >=22 is required; found ${process.version}.`);
    console.log(`Node ${process.version} (${process.platform}/${process.arch})`);
    const version = run(manager.command, [...manager.prefix, '--version'], { capture: true, timeout: 15_000 });
    const expected = manifest.packageManager.replace(/^pnpm@/, '').split('+')[0];
    if (version !== expected) throw new Error(`Expected pnpm ${expected}; found ${version}. Use the packageManager version in package.json.`);
    console.log(`pnpm ${version}`);
    console.log(run('git', ['--version'], { capture: true, timeout: 15_000 }));
    for (const dependency of ['typescript', 'tsx']) {
      if (!existsSync(path.join(root, 'node_modules', dependency, 'package.json'))) {
        throw new Error(`Missing ${dependency}. Run pnpm install --frozen-lockfile.`);
      }
    }
    console.log('Development dependencies are installed. Environment preflight passed.');
  } else {
    for (const script of ['typecheck', 'build', 'test']) step(script, () => pnpm(['run', script]));
    if (mode === 'check:package') {
      // Build already passed above. Ordinary pnpm pack still runs prepack.
      step('pack the checked build', () => pnpm(['--config.ignore-scripts=true', 'pack', '--pack-destination', '.artifacts']));
      step('installed package smoke', () => pnpm(['run', 'test:package']));
    }
    console.log(`\n[devops-agent] ${mode} passed.`);
  }
} catch (error) {
  console.error(`[devops-agent] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
