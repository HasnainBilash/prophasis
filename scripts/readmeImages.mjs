// Takes the README images in a real VS Code and builds the animated demo.
// Output: docs/images/{demo,hero,class-light,uses-and-types}.png
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'docs', 'images');
execFileSync(
  process.execPath,
  [resolve(root, 'test', 'feasibility', 'runProbe.mjs'), 'readmeShots'],
  {
    stdio: 'inherit',
    env: { ...process.env, PROBE_PYTHON: '0', PROBE_LABEL: 'readme', README_DIR: dir },
  },
);
const frames = readdirSync(join(dir, 'frames'))
  .filter((f) => f.endsWith('.png'))
  .sort()
  .map((f) => join(dir, 'frames', f));
execFileSync(
  process.execPath,
  [resolve(root, 'scripts', 'apng.mjs'), join(dir, 'demo.png'), '1600', ...frames],
  {
    stdio: 'inherit',
  },
);
rmSync(join(dir, 'frames'), { recursive: true, force: true });
