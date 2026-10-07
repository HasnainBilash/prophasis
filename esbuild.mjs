import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// The extension and the feasibility probe both run inside the VS Code
// extension host, which provides the `vscode` module at run time.
const options = {
  entryPoints: {
    extension: 'src/extension/extension.ts',
    probe: 'test/feasibility/probe.ts',
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

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
