/**
 * Runs the real graph engine inside VS Code on the fixture projects and
 * compares its output with expected graphs written by hand from the fixture
 * source. Fails (non-zero exit) on any difference. Started by
 * `npm run check:engine`.
 */
import { writeFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { DEFAULT_OPTIONS, GraphBuilder } from '../../src/extension/engine/builder';
import { createVscodeQueries } from '../../src/extension/engine/vscodeQueries';
import type { FlowGraph } from '../../src/shared/types';

interface Case {
  file: string;
  /** 1-based line and column of a position inside the symbol. */
  at: [number, number];
  expected: {
    status: string;
    root: string;
    recursive?: boolean;
    /** "order name kind path:line @ call lines", in arrow order. */
    calls?: string[];
    /** "name path:line @ call lines". */
    calledBy?: string[];
    /** Methods and constructors on a class card, in line order. */
    members?: string[];
    /** The start card's doc comment (first paragraph). */
    doc?: string;
    /** "user path:line @ reference lines", sorted. */
    usedBy?: string[];
    /** "child extends|implements parent path:line-of-the-other-card", sorted. */
    types?: string[];
  };
}

// Expected values come from reading the fixture files, not from earlier runs.
// Library calls (JSON.stringify, Math.max, len, json.dumps, ValueError) are
// hidden by default, so they are absent.
const cases: Case[] = [
  {
    file: 'ts/src/orders/orderService.ts',
    at: [13, 5],
    expected: {
      status: 'ok',
      root: 'method placeOrder ts/src/orders/orderService.ts:12',
      calls: [
        '1 validateCart function ts/src/cart/validate.ts:6 @ 13,19',
        '2 chargePayment method ts/src/orders/orderService.ts:27 @ 16',
        '3 total function ts/src/orders/orderService.ts:32 @ 16',
        '4 sendReceipt function ts/src/notify/email.ts:1 @ 17',
        '5 audit method ts/src/orders/base.ts:2 @ 18',
      ],
      calledBy: ['main ts/src/main.ts:4 @ 6'],
    },
  },
  {
    file: 'ts/src/orders/orderService.ts',
    at: [7, 15],
    expected: {
      status: 'ok',
      root: 'class OrderService ts/src/orders/orderService.ts:7',
      doc: 'Creates and pays for customer orders.',
      members: [
        'constructor constructor:8',
        'method placeOrder:12',
        'method cancelOrder:23',
        'method chargePayment:27',
      ],
      calledBy: ['main ts/src/main.ts:4 @ 5'],
    },
  },
  {
    file: 'ts/src/notify/email.ts',
    at: [6, 3],
    expected: {
      status: 'ok',
      root: 'function retry ts/src/notify/email.ts:5',
      recursive: true,
      calls: [],
      calledBy: ['sendReceipt ts/src/notify/email.ts:1 @ 2'],
    },
  },
  {
    file: 'ts/src/notify/email.ts',
    at: [13, 3],
    expected: {
      status: 'ok',
      root: 'function isEven ts/src/notify/email.ts:12',
      recursive: true,
      calls: ['1 isOdd function ts/src/notify/email.ts:16 @ 13'],
      calledBy: ['isOdd ts/src/notify/email.ts:16 @ 17'],
    },
  },
  {
    file: 'js/src/report.js',
    at: [4, 3],
    expected: {
      status: 'ok',
      root: 'function buildReport js/src/report.js:3',
      calls: [
        // `new Circle(r).describe()`: Circle is written first.
        '1 Circle class js/src/shapes.js:11 @ 4',
        '2 describe method js/src/shapes.js:6 @ 4',
        '3 square function js/src/shapes.js:23 @ 5',
        '4 countdown function js/src/report.js:9 @ 6',
      ],
      calledBy: [],
    },
  },
  {
    file: 'js/src/shapes.js',
    at: [27, 15],
    expected: {
      status: 'empty',
      root: 'function format js/src/shapes.js:27',
      calls: [],
      calledBy: ['describe js/src/shapes.js:6 @ 7'],
    },
  },
  {
    file: 'py/shop/orders/order_service.py',
    at: [16, 9],
    expected: {
      status: 'ok',
      root: 'method place_order py/shop/orders/order_service.py:15',
      calls: [
        '1 validate_cart function py/shop/cart/validate.py:1 @ 16,21',
        '2 _charge_payment method py/shop/orders/order_service.py:27 @ 18',
        '3 total function py/shop/orders/order_service.py:31 @ 18',
        '4 send_receipt function py/shop/notify/email.py:1 @ 19',
        '5 audit method py/shop/orders/base.py:2 @ 20',
      ],
      calledBy: ['main py/shop/main.py:5 @ 7'],
    },
  },
  {
    file: 'py/shop/orders/order_service.py',
    at: [9, 8],
    expected: {
      status: 'ok',
      root: 'class OrderService py/shop/orders/order_service.py:9',
      members: [
        'constructor __init__:12',
        'method place_order:15',
        'method cancel_order:24',
        'method _charge_payment:27',
      ],
      calledBy: ['main py/shop/main.py:5 @ 6'],
    },
  },
  {
    file: 'py/shop/notify/email.py',
    at: [6, 5],
    expected: {
      status: 'ok',
      root: 'function retry py/shop/notify/email.py:5',
      recursive: true,
      calls: [],
      calledBy: ['send_receipt py/shop/notify/email.py:1 @ 2'],
    },
  },
  {
    file: 'py/shop/notify/email.py',
    at: [12, 5],
    expected: {
      status: 'ok',
      root: 'function is_even py/shop/notify/email.py:11',
      recursive: true,
      calls: ['1 is_odd function py/shop/notify/email.py:15 @ 12'],
      calledBy: ['is_odd py/shop/notify/email.py:15 @ 16'],
    },
  },
  // Used by and extends (Phase 4). The import of PaymentProvider in
  // orderService.ts is top-level code, so it has no card and is left out.
  {
    file: 'ts/src/payments/gateway.ts',
    at: [1, 19],
    expected: {
      status: 'ok',
      root: 'interface PaymentProvider ts/src/payments/gateway.ts:1',
      members: ['method charge:2'],
      usedBy: [
        'PaymentGateway ts/src/payments/gateway.ts:5 @ 5',
        'constructor ts/src/orders/orderService.ts:8 @ 8',
      ],
      types: ['PaymentGateway implements PaymentProvider ts/src/payments/gateway.ts:5'],
    },
  },
  {
    file: 'js/src/shapes.js',
    at: [1, 15],
    expected: {
      status: 'ok',
      root: 'class Shape js/src/shapes.js:1',
      types: ['Circle extends Shape js/src/shapes.js:11'],
    },
  },
  {
    file: 'py/shop/cart/validate.py',
    at: [1, 6],
    expected: {
      status: 'ok',
      root: 'function validate_cart py/shop/cart/validate.py:1',
      doc: 'Checks that a cart can be ordered.',
      usedBy: ['place_order py/shop/orders/order_service.py:15 @ 16,21'],
    },
  },
  {
    file: 'py/shop/orders/order_service.py',
    at: [9, 8],
    expected: {
      status: 'ok',
      root: 'class OrderService py/shop/orders/order_service.py:9',
      types: ['OrderService extends BaseService py/shop/orders/base.py:1'],
    },
  },
  {
    // Python has a full type hierarchy; the parent ABC is library code, so hidden.
    file: 'py/shop/payments/gateway.py',
    at: [4, 8],
    expected: {
      status: 'ok',
      root: 'class PaymentProvider py/shop/payments/gateway.py:4',
      types: ['PaymentGateway extends PaymentProvider py/shop/payments/gateway.py:9'],
    },
  },
];

// CodeLens buttons expected per file (1-based lines), checked against the source.
const expectedLenses: Record<string, number[]> = {
  'ts/src/orders/orderService.ts': [7, 8, 12, 23, 27, 32],
  'js/src/shapes.js': [1, 2, 6, 11, 12, 17, 23, 27],
  'py/shop/notify/email.py': [1, 5, 11, 15],
};

let fixturesRoot: vscode.Uri;

export async function run(): Promise<void> {
  const out = process.env.PROBE_OUT;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!out || !folder) {
    throw new Error('PROBE_OUT must be set and the fixtures workspace must be open');
  }
  fixturesRoot = vscode.Uri.joinPath(folder.uri, '..');
  const token = new vscode.CancellationTokenSource().token;
  const failures: string[] = [];
  const results: unknown[] = [];
  // Written after every case, so a crash still leaves a record of how far it got.
  const save = (stage: string) =>
    writeFileSync(
      out,
      JSON.stringify({ vscodeVersion: vscode.version, stage, failures, results }, null, 2),
    );
  save('started');

  for (const c of cases) {
    const uri = vscode.Uri.joinPath(fixturesRoot, c.file);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    const started = Date.now();
    let actual = await summariseSafely(token, uri, c);
    // Wait for the language server: "starting" answers and timeouts are retried
    // (a cold CI machine can take well over a minute for the first answer).
    while (actual.status !== c.expected.status && Date.now() - started < WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      actual = await summariseSafely(token, uri, c);
    }
    const label = `${c.file}:${c.at[0]}`;
    for (const key of Object.keys(c.expected) as (keyof Case['expected'])[]) {
      const want = JSON.stringify(c.expected[key]);
      const got = JSON.stringify(actual[key]);
      if (want !== got) {
        failures.push(`${label} ${key}\n    expected ${want}\n    actual   ${got}`);
      }
    }
    results.push({ case: label, ms: actual.ms, actual });
    console.log(`[engine] ${label}: ${actual.status} in ${actual.ms} ms`);
    save(label);
  }

  for (const [file, lines] of Object.entries(expectedLenses)) {
    const uri = vscode.Uri.joinPath(fixturesRoot, file);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    const started = Date.now();
    let got: number[];
    do {
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        uri,
      );
      got = (lenses ?? [])
        .filter((l) => l.command?.command === 'prophasis.showFlow')
        .map((l) => l.range.start.line + 1);
      if (JSON.stringify(got) === JSON.stringify(lines)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (Date.now() - started < WAIT_MS);
    if (JSON.stringify(got) !== JSON.stringify(lines)) {
      failures.push(
        `${file} buttons\n    expected ${JSON.stringify(lines)}\n    actual   ${JSON.stringify(got)}`,
      );
    }
    results.push({ lenses: file, lines: got });
  }

  save('done');
  if (failures.length > 0) {
    throw new Error(`${failures.length} difference(s):\n  ${failures.join('\n  ')}`);
  }
  console.log(
    `[engine] all ${cases.length} graphs and ${Object.keys(expectedLenses).length} button lists match`,
  );
}

/** Longest wait for a language server to give the expected answer. */
const WAIT_MS = 120_000;

/** Like summarise, but a timeout or other error becomes a status, so it can be retried. */
async function summariseSafely(token: vscode.CancellationToken, uri: vscode.Uri, c: Case) {
  try {
    return await summarise(token, uri, c);
  } catch (error) {
    return { status: `error: ${String(error)}`, ms: 0 } as Awaited<ReturnType<typeof summarise>>;
  }
}

/** Builds a graph the way the "Show flow" command does, and reduces it to comparable text. */
async function summarise(token: vscode.CancellationToken, uri: vscode.Uri, c: Case) {
  const started = Date.now();
  const builder = new GraphBuilder(createVscodeQueries(token), DEFAULT_OPTIONS);
  const result = await builder.start(uri.toString(), { line: c.at[0] - 1, character: c.at[1] - 1 });
  if (result.graph) {
    await builder.expand(result.graph.rootId, 'calledBy');
    if (c.expected.usedBy) {
      await builder.expand(result.graph.rootId, 'usedBy');
    }
    if (c.expected.types) {
      await builder.expand(result.graph.rootId, 'extends');
    }
  }
  const graph = builder.snapshot();
  const ms = Date.now() - started;
  const root = graph.nodes.find((n) => n.id === graph.rootId);
  if (!result.graph || !root) {
    return { status: result.status, ms } as Record<string, unknown> & {
      status: string;
      ms: number;
    };
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const where = (id: string) => {
    const n = byId.get(id);
    return n ? `${n.filePath}:${n.line}` : '?';
  };
  const summary: Record<string, unknown> & { status: string; ms: number } = {
    status: result.status,
    ms,
    root: `${root.kind} ${root.name} ${root.filePath}:${root.line}`,
    recursive: root.isRecursive,
    doc: root.docComment,
    calls: outgoing(graph, root.id).map(
      (e) =>
        `${e.order} ${byId.get(e.toId)?.name} ${byId.get(e.toId)?.kind} ${where(e.toId)} @ ${e.callLines.join(',')}`,
    ),
    calledBy: graph.edges
      .filter((e) => e.toId === root.id && (e.kind === 'calls' || e.kind === 'calledBy'))
      .map((e) => `${byId.get(e.fromId)?.name} ${where(e.fromId)} @ ${e.callLines.join(',')}`),
  };
  summary.usedBy = graph.edges
    .filter((e) => e.toId === root.id && e.kind === 'usedBy')
    .map((e) => `${byId.get(e.fromId)?.name} ${where(e.fromId)} @ ${e.callLines.join(',')}`)
    .sort();
  summary.types = graph.edges
    .filter(
      (e) =>
        (e.kind === 'extends' || e.kind === 'implements') &&
        (e.fromId === root.id || e.toId === root.id),
    )
    .map((e) => {
      const other = e.fromId === root.id ? e.toId : e.fromId;
      return `${byId.get(e.fromId)?.name} ${e.kind} ${byId.get(e.toId)?.name} ${where(other)}`;
    })
    .sort();
  if (root.members) {
    summary.members = root.members
      .filter((m) => m.kind !== 'field')
      .map((m) => `${m.kind} ${m.name}:${m.line}`);
    summary.fields = root.members
      .filter((m) => m.kind === 'field')
      .map((m) => `${m.name}:${m.line}`);
    delete summary.calls;
  }
  return summary;
}

function outgoing(graph: FlowGraph, rootId: string) {
  return graph.edges
    .filter((e) => e.fromId === rootId && e.kind === 'calls')
    .sort((a, b) => a.order - b.order);
}
