// Downloads a separate copy of VS Code into .vscode-test/, installs the Python
// extension into that copy only, and runs the probe inside it.
// Usage: npm run probe            (latest stable VS Code)
//        PROBE_VSCODE=1.90.0 npm run probe   (a specific version)
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const version = process.env.PROBE_VSCODE ?? 'stable';
const withPython = process.env.PROBE_PYTHON !== '0';

const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
const extensionsDir = resolve(root, '.vscode-test', 'extensions');
const userDataDir = resolve(root, '.vscode-test', 'user-data');

if (withPython) {
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath, {
    reuseMachineInstall: false,
  });
  for (const id of ['ms-python.python', 'ms-python.vscode-pylance']) {
    const result = spawnSync(cli, [...cliArgs, '--install-extension', id], {
      encoding: 'utf8',
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      throw new Error(`Installing ${id} failed with exit code ${result.status}`);
    }
  }
}

const outDir = resolve(root, '.vscode-test', 'results');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `probe-${version}.json`);

// When this runs from a terminal inside VS Code, ELECTRON_RUN_AS_NODE=1 is inherited
// and would start the test copy of VS Code as plain Node instead of the editor.
delete process.env.ELECTRON_RUN_AS_NODE;

await runTests({
  vscodeExecutablePath,
  extensionDevelopmentPath: root,
  extensionTestsPath: resolve(root, 'dist', 'probe.js'),
  extensionTestsEnv: { PROBE_OUT: out },
  launchArgs: [
    resolve(root, 'test', 'fixtures', 'fixtures.code-workspace'),
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    // The Python Environments extension closed the test window on a machine with no
    // Python installed. Code analysis doesn't need it, so it is off by default.
    ...(process.env.PROBE_DISABLE ?? 'ms-python.vscode-python-envs')
      .split(',')
      .filter(Boolean)
      .map((id) => `--disable-extension=${id}`),
  ],
});

console.log(`Probe results written to ${out}`);
