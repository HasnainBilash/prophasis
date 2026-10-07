// Downloads a separate copy of VS Code into .vscode-test/, installs the Python
// extension into that copy only, and runs the probe inside it.
// Usage: npm run probe            (latest stable VS Code)
//        PROBE_VSCODE=1.90.0 npm run probe   (a specific version)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

// The last lines printed (including VS Code's own output), quoted in CI
// annotations when something fails.
const recent = [];
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    recent.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    recent.splice(0, Math.max(0, recent.length - 40));
    return write(chunk, ...rest);
  };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const version = process.env.PROBE_VSCODE ?? 'stable';
// Which bundle in dist/ to run: 'probe' (Phase 1 feasibility) or 'engineCheck'.
const suite = process.argv[2] ?? 'probe';
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
      shell: process.platform === 'win32',
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.status !== 0) {
      fail(`Installing ${id} failed (exit ${result.status}): ${result.stderr || result.error}`);
    }
  }
}

const outDir = resolve(root, '.vscode-test', 'results');
mkdirSync(outDir, { recursive: true });
// PROBE_LABEL names the results file when one suite runs on several workspaces.
const label = process.env.PROBE_LABEL ? `-${process.env.PROBE_LABEL}` : '';
const out = resolve(outDir, `${suite}${label}-${version}.json`);
// PROBE_WORKSPACE opens another folder (a generated or real project) instead of the fixtures.
const workspace =
  process.env.PROBE_WORKSPACE ?? resolve(root, 'test', 'fixtures', 'fixtures.code-workspace');

// Settings for the throwaway test copy only (never the user's own VS Code):
// a maximised window with no welcome page, tips or chat side bar, so
// screenshots show just the editor and the panel.
mkdirSync(resolve(userDataDir, 'User'), { recursive: true });
writeFileSync(
  resolve(userDataDir, 'User', 'settings.json'),
  JSON.stringify(
    {
      'window.newWindowDimensions': 'maximized',
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'chat.disableAIFeatures': true,
      'editor.minimap.enabled': false,
      'git.openRepositoryInParentFolders': 'never',
      'update.mode': 'none',
      'telemetry.telemetryLevel': 'off',
    },
    null,
    2,
  ),
);

// When this runs from a terminal inside VS Code, ELECTRON_RUN_AS_NODE=1 is inherited
// and would start the test copy of VS Code as plain Node instead of the editor.
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: resolve(root, 'dist', `${suite}.js`),
    extensionTestsEnv: {
      PROBE_OUT: out,
      SCREENSHOT_DIR: resolve(root, '.vscode-test', 'screenshots'),
      PERF_TARGETS: process.env.PERF_TARGETS ?? '',
    },
    launchArgs: [
      workspace,
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
} catch (error) {
  // The check writes its list of differences before failing; show it.
  const saved = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined;
  const details = saved?.failures;
  const why = details
    ? ` (stopped at: ${saved.stage ?? 'end'})\n${details.join('\n')}`
    : ' (no results written: VS Code may not have started)';
  fail(`${suite} failed: ${String(error)}${why}`);
}

console.log(`Probe results written to ${out}`);

/**
 * Stops with an error. On GitHub Actions the message also becomes an
 * annotation, which can be read without access to the job log.
 */
function fail(message) {
  if (process.env.GITHUB_ACTIONS) {
    const encoded = message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
    const tail = recent.map((line) => line.replace(/%/g, '%25')).join('%0A');
    console.log(`::error title=${suite}::${encoded}`);
    console.log(`::error title=${suite} output::${tail}`);
  }
  console.error(message);
  process.exit(1);
}
