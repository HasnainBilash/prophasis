// Generates a synthetic TypeScript project for the performance check:
// 50 files x 20 functions = 1,000 functions, each calling up to three others
// (some in other files), 50 classes with methods, and one "hub" that calls 100
// functions. Output: .vscode-test/perf/ts-1000 (not committed).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = resolve(root, '.vscode-test', 'perf', 'ts-1000');
const FILES = 50;
const PER_FILE = 20;

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, 'src'), { recursive: true });
writeFileSync(
  resolve(out, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ES2022', strict: true },
    include: ['src'],
  }),
);

const name = (file, fn) => `f${file}_${fn}`;
for (let file = 0; file < FILES; file++) {
  const imports = new Set();
  const lines = [];
  for (let fn = 0; fn < PER_FILE; fn++) {
    // Deterministic "random" callees: two in this file, one in the next file.
    const callees = [
      [file, (fn + 1) % PER_FILE],
      [file, (fn * 7 + 3) % PER_FILE],
      [(file + 1) % FILES, (fn * 3) % PER_FILE],
    ].filter(([f, n]) => !(f === file && n === fn));
    const body = callees.map(([f, n]) => {
      if (f !== file) imports.add(`import { ${name(f, n)} } from './m${f}';`);
      return `  total += ${name(f, n)}(depth - 1);`;
    });
    lines.push(
      `export function ${name(file, fn)}(depth: number): number {`,
      `  if (depth <= 0) return ${fn};`,
      `  let total = 0;`,
      ...body,
      `  return total;`,
      `}`,
      '',
    );
  }
  lines.push(
    `export class Service${file} {`,
    `  run(): number {`,
    `    return ${name(file, 0)}(2) + this.helper();`,
    `  }`,
    `  helper(): number {`,
    `    return ${name(file, 1)}(1);`,
    `  }`,
    `}`,
    '',
  );
  writeFileSync(resolve(out, 'src', `m${file}.ts`), [...imports, '', ...lines].join('\n'));
}

// One function with a very large fan-out.
const hubCalls = Array.from({ length: 100 }, (_, i) => name(Math.floor(i / 2), i % PER_FILE));
const hubImports = [...new Set(hubCalls.map((c) => c.split('_')[0].slice(1)))].map(
  (f) => `import { ${hubCalls.filter((c) => c.startsWith(`f${f}_`)).join(', ')} } from './m${f}';`,
);
writeFileSync(
  resolve(out, 'src', 'hub.ts'),
  [
    ...hubImports,
    '',
    'export function hub(): number {',
    '  let total = 0;',
    ...hubCalls.map((c) => `  total += ${c}(0);`),
    '  return total;',
    '}',
    '',
  ].join('\n'),
);

console.log(`Generated ${FILES * PER_FILE} functions, ${FILES} classes and a hub in ${out}`);
