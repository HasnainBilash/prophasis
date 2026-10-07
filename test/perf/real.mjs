// Measures Prophasis on real open-source projects (docs/PLAN.md section 6):
// immer (TypeScript) and requests (Python), shallow-cloned into
// .vscode-test/real. Their code is only read by the language servers, never
// run; their .vscode folders are removed so no project settings or tasks apply.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const realDir = resolve(root, '.vscode-test', 'real');

const projects = [
  {
    name: 'immer',
    url: 'https://github.com/immerjs/immer.git',
    python: '0',
    targets: [
      { file: 'src/core/immerClass.ts', symbol: 'produce', line: 83 },
      { file: 'src/core/finalize.ts', symbol: 'processResult' },
      { file: 'src/core/proxy.ts', symbol: 'createProxyProxy' },
      { file: 'src/core/proxy.ts', symbol: 'markChanged' },
    ],
  },
  {
    name: 'requests',
    url: 'https://github.com/psf/requests.git',
    python: '1',
    targets: [
      { file: 'src/requests/api.py', symbol: 'get' },
      { file: 'src/requests/sessions.py', symbol: 'prepare_request' },
      { file: 'src/requests/sessions.py', symbol: 'resolve_redirects' },
      { file: 'src/requests/sessions.py', symbol: 'merge_setting' },
    ],
  },
];

for (const project of projects) {
  const dir = resolve(realDir, project.name);
  if (!existsSync(dir)) {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', project.url, dir], {
      stdio: 'inherit',
    });
  }
  rmSync(resolve(dir, '.vscode'), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [resolve(root, 'test', 'feasibility', 'runProbe.mjs'), 'perfCheck'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PROBE_PYTHON: project.python,
        PROBE_LABEL: project.name,
        PROBE_WORKSPACE: dir,
        PERF_TARGETS: JSON.stringify(project.targets),
      },
    },
  );
}
