import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// The extension and the test suites run inside the VS Code extension host,
// which provides the `vscode` module at run time.
const host = {
  entryPoints: {
    extension: 'src/extension/extension.ts',
    probe: 'test/feasibility/probe.ts',
    engineCheck: 'test/integration/engineCheck.ts',
    panelCheck: 'test/integration/panelCheck.ts',
    perfCheck: 'test/integration/perfCheck.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

// The panel runs in a browser-like webview. Its CSS imports (React Flow's
// stylesheet and ours) are bundled into dist/webview.css.
const webview = {
  entryPoints: { webview: 'src/webview/main.tsx' },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'info',
};

if (watch) {
  await Promise.all(
    [host, webview].map(async (options) => (await esbuild.context(options)).watch()),
  );
} else {
  await Promise.all([esbuild.build(host), esbuild.build(webview)]);
}
