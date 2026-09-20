import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works from both TypeScript sources and an installed, compiled tarball.
let directory = path.dirname(fileURLToPath(import.meta.url));
while (true) {
  try {
    const metadata = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (metadata.name === 'devops-agent') break;
  } catch { /* ascend */ }
  const parent = path.dirname(directory);
  if (parent === directory) throw new Error('Cannot locate devops-agent package metadata');
  directory = parent;
}
export const packageRoot = directory;
export const packageVersion: string = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
