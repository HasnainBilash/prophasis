// Generates the 1,000-function project and measures it (docs/PLAN.md section 5).
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
execFileSync(process.execPath, [resolve(root, 'test', 'perf', 'generate.mjs')], {
  stdio: 'inherit',
});

const targets = [
  { file: 'src/m10.ts', symbol: 'f10_5' },
  { file: 'src/m25.ts', symbol: 'f25_0' },
  { file: 'src/m40.ts', symbol: 'f40_12' },
  { file: 'src/m3.ts', symbol: 'run' },
  { file: 'src/hub.ts', symbol: 'hub' },
];
execFileSync(
  process.execPath,
  [resolve(root, 'test', 'feasibility', 'runProbe.mjs'), 'perfCheck'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PROBE_PYTHON: '0',
      PROBE_LABEL: 'generated',
      PROBE_WORKSPACE: resolve(root, '.vscode-test', 'perf', 'ts-1000'),
      PERF_TARGETS: JSON.stringify(targets),
    },
  },
);
