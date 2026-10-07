import * as vscode from 'vscode';
import { FlowCodeLensProvider, SHOW_FLOW } from './codeLens';
import { GraphBuilder, type BuilderOptions } from './engine/builder';
import { CancelledError, QueryTimeoutError } from './engine/queries';
import { createVscodeQueries, trackOpenedDocuments } from './engine/vscodeQueries';
import { PanelManager } from './panel';
import { forgetDocument } from './symbols';

// Activation only registers things. Nothing scans the workspace.
export function activate(context: vscode.ExtensionContext): void {
  const panels = new PanelManager();
  const codeLenses = new FlowCodeLensProvider();
  let current: vscode.CancellationTokenSource | undefined;
  const cancelCurrent = () => {
    current?.cancel();
    current?.dispose();
    current = undefined;
  };

  context.subscriptions.push(
    panels,
    codeLenses,
    trackOpenedDocuments(),
    panels.onDidClose(cancelCurrent),
    { dispose: cancelCurrent },
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLenses),
    vscode.commands.registerCommand(SHOW_FLOW, async (...args: unknown[]) => {
      // A new start replaces the graph, so anything still loading is cancelled.
      cancelCurrent();
      current = new vscode.CancellationTokenSource();
      await showFlow(panels, current.token, args);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => forgetDocument(document.uri)),
  );
}

export function deactivate(): void {}

function readOptions(): BuilderOptions & { depth: number } {
  const config = vscode.workspace.getConfiguration('prophasis');
  return {
    depth: config.get<number>('defaultDepth', 1),
    maxCards: config.get<number>('maxCards', 150),
    showExternalCode: config.get<boolean>('showExternalCode', false),
    excludeGlobs: config.get<string[]>('excludeGlobs', []),
  };
}

/**
 * Called from the CodeLens with (uri, line, character), or from the command
 * palette with no arguments (then the cursor is used).
 */
async function showFlow(
  panels: PanelManager,
  token: vscode.CancellationToken,
  args: unknown[],
): Promise<void> {
  const target = readTarget(args);
  if (!target) {
    void vscode.window.showInformationMessage(
      'Prophasis: put the cursor inside a function, method or class, then run "Show Flow".',
    );
    return;
  }

  const { depth, ...options } = readOptions();
  const builder = new GraphBuilder(createVscodeQueries(token), options);
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Prophasis: finding calls' },
      async () => {
        const started = await builder.start(target.uri.toString(), target.position);
        const graph = started.graph;
        if (graph && started.status !== 'languageServerStarting') {
          await loadDeeper(builder, graph.rootId, depth);
          // The text preview also lists callers; Phase 3 loads them on click.
          await builder.expand(graph.rootId, 'calledBy');
        }
        return { status: started.status, graph: graph && builder.snapshot() };
      },
    );
    if (token.isCancellationRequested) {
      return;
    }
    if (result.status === 'noSymbol') {
      void vscode.window.showInformationMessage(
        'Prophasis: no function, method or class found here.',
      );
      return;
    }
    const root = result.graph?.nodes.find((n) => n.id === result.graph?.rootId);
    panels.show({ title: root?.name ?? 'Show flow', status: result.status, graph: result.graph });
  } catch (error) {
    if (error instanceof CancelledError) {
      return;
    }
    const message =
      error instanceof QueryTimeoutError
        ? 'The language server took too long to answer. It may still be indexing the project; try again in a moment.'
        : `Something went wrong: ${String(error)}`;
    panels.show({ title: 'Show flow', status: 'error', message });
  }
}

/** With defaultDepth above 1, keeps loading calls level by level. */
async function loadDeeper(builder: GraphBuilder, rootId: string, depth: number): Promise<void> {
  let frontier = [rootId];
  for (let level = 1; level < depth; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = builder.snapshot().nodes.find((n) => n.id === id);
      if (!node || node.members) {
        continue;
      }
      const patch = await builder.expand(id, 'calls');
      next.push(...patch.addNodes.map((n) => n.id));
    }
    frontier = next;
  }
}

function readTarget(args: unknown[]): { uri: vscode.Uri; position: vscode.Position } | undefined {
  const [first, second, third] = args;
  if (typeof first === 'string') {
    const uri = vscode.Uri.parse(first, true);
    if (typeof second === 'number' && typeof third === 'number') {
      return { uri, position: new vscode.Position(second, third) };
    }
    return undefined;
  }
  const editor = vscode.window.activeTextEditor;
  return editor ? { uri: editor.document.uri, position: editor.selection.active } : undefined;
}
