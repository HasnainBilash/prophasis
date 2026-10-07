// Packages the extension and checks the installed .vsix in a clean VS Code.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { name, version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
execFileSync(
  process.execPath,
  [resolve(root, 'test', 'feasibility', 'runProbe.mjs'), 'vsixCheck'],
  {
    stdio: 'inherit',
    env: { ...process.env, PROBE_PYTHON: '0', PROBE_VSIX: `${name}-${version}.vsix` },
  },
);
