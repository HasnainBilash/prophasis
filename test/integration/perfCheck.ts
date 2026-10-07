/**
 * Measures the docs/PLAN.md section 5 targets inside a real VS Code, on the
 * workspace given by the runner (the generated 1,000-function project or a
 * real open-source project). Targets come from PERF_TARGETS: a JSON list of
 * { file, symbol } relative to the workspace folder. Writes timings and a
 * readable summary of each graph, for checking by hand against the source.
 * Started by `npm run check:perf`.
 */
import { writeFileSync } from 'node:fs';
import * as vscode from 'vscode';
import {
  clearCallCache,
  DEFAULT_OPTIONS,
  GraphBuilder,
  type StartResult,
} from '../../src/extension/engine/builder';
import { createVscodeQueries } from '../../src/extension/engine/vscodeQueries';
import type { FlowGraph } from '../../src/shared/types';
import { layoutGraph } from '../../src/webview/layout';
import type { ProphasisTestApi } from '../../src/extension/extension';

interface Target {
  file: string;
  symbol: string;
  /** 1-based line, when the name appears more than once in the file. */
  line?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0) : null;
};

export async function run(): Promise<void> {
  const out = process.env.PROBE_OUT;
  const folder = vscode.workspace.workspaceFolders?.[0];
  const targets = JSON.parse(process.env.PERF_TARGETS ?? '[]') as Target[];
  if (!out || !folder || targets.length === 0) {
    throw new Error('PROBE_OUT, PERF_TARGETS and a workspace folder are needed');
  }
  const report: Record<string, unknown> = { vscodeVersion: vscode.version, stage: 'started' };
  const save = () => writeFileSync(out, JSON.stringify(report, null, 2));
  save();

  const extension = vscode.extensions.getExtension<ProphasisTestApi>('prophasis.prophasis');
  const api = await extension?.activate();
  report.activationMs = api ? Math.round(api.activationMs * 10) / 10 : null;

  const token = new vscode.CancellationTokenSource().token;
  const startAt = async (
    target: Target,
  ): Promise<{ result: StartResult; ms: number; builder: GraphBuilder } | undefined> => {
    const uri = vscode.Uri.joinPath(folder.uri, target.file);
    const position = await findSymbol(uri, target.symbol, target.line);
    if (!position) {
      return undefined;
    }
    clearCallCache();
    const builder = new GraphBuilder(createVscodeQueries(token), DEFAULT_OPTIONS);
    const started = performance.now();
    const result = await builder.start(uri.toString(), position);
    return { result, ms: performance.now() - started, builder };
  };

  // Cold start: open the first file and wait until the language server answers.
  const first = targets[0];
  if (!first) {
    throw new Error('no targets');
  }
  const coldStarted = performance.now();
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, first.file)),
  );
  for (;;) {
    const attempt = await startAt(first).catch(() => undefined);
    if (attempt?.result.status === 'ok' || performance.now() - coldStarted > 180_000) {
      break;
    }
    await sleep(1000);
  }
  report.languageServerReadyMs = Math.round(performance.now() - coldStarted);
  report.stage = 'ready';
  save();

  const startMs: number[] = [];
  const calledByMs: number[] = [];
  const expandMs: number[] = [];
  const layoutMs: number[] = [];
  const graphs: unknown[] = [];
  for (const target of targets) {
    const attempt = await startAt(target);
    if (!attempt) {
      graphs.push({ target, error: 'symbol not found' });
      continue;
    }
    startMs.push(attempt.ms);
    const { builder } = attempt;
    const rootId = attempt.result.graph?.rootId ?? '';

    let started = performance.now();
    await builder.expand(rootId, 'calledBy');
    calledByMs.push(performance.now() - started);

    // Expanding one card: the first callee's own calls.
    const callee = builder.snapshot().edges.find((e) => e.fromId === rootId && e.kind === 'calls');
    if (callee) {
      started = performance.now();
      await builder.expand(callee.toId, 'calls');
      expandMs.push(performance.now() - started);
    }

    const graph = builder.snapshot();
    started = performance.now();
    layoutGraph(new Map(graph.nodes.map((n) => [n.id, n])), graph.edges);
    layoutMs.push(performance.now() - started);
    graphs.push({ target, status: attempt.result.status, ...describe(graph) });
    report.stage = `${target.file} ${target.symbol}`;
    report.graphs = graphs;
    save();
  }

  report.medianMs = {
    firstOpen: median(startMs),
    calledBy: median(calledByMs),
    expandOneCard: median(expandMs),
    layout: median(layoutMs),
  };
  report.maxMs = {
    firstOpen: Math.round(Math.max(...startMs)),
    expandOneCard: expandMs.length ? Math.round(Math.max(...expandMs)) : null,
  };
  report.stage = 'done';
  save();
  console.log(
    `[perf] ${JSON.stringify({ activationMs: report.activationMs, ...(report.medianMs as object) })}`,
  );
}

/** Where a symbol's name is, found by name in the file's symbols. */
async function findSymbol(
  uri: vscode.Uri,
  name: string,
  line?: number,
): Promise<vscode.Position | undefined> {
  await vscode.workspace.openTextDocument(uri);
  const symbols =
    (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      uri,
    )) ?? [];
  const stack = [...symbols];
  for (let s = stack.shift(); s; s = stack.shift()) {
    if (s.name === name && (line === undefined || s.selectionRange.start.line === line - 1)) {
      return s.selectionRange.start;
    }
    stack.push(...(s.children ?? []));
  }
  return undefined;
}

/** A readable summary of a graph: what the start calls, what calls it, and size. */
function describe(graph: FlowGraph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const label = (id: string) => {
    const n = byId.get(id);
    return n ? `${n.name} (${n.filePath}:${n.line})` : id;
  };
  const root = byId.get(graph.rootId);
  return {
    root: root && label(root.id),
    cards: graph.nodes.length,
    more: root?.more,
    calls: graph.edges
      .filter((e) => e.fromId === graph.rootId && e.kind === 'calls')
      .sort((a, b) => a.order - b.order)
      .map((e) => `${e.order}. ${label(e.toId)} @ ${e.callLines.join(',')}`),
    calledBy: graph.edges
      .filter((e) => e.toId === graph.rootId && (e.kind === 'calls' || e.kind === 'calledBy'))
      .map((e) => `${label(e.fromId)} @ ${e.callLines.join(',')}`),
  };
}
