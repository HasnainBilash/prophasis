import * as vscode from 'vscode';
import { FlowCodeLensProvider, SHOW_FLOW } from './codeLens';
import { GraphBuilder, type BuilderOptions } from './engine/builder';
import { CancelledError, QueryTimeoutError } from './engine/queries';
import { createVscodeQueries, trackOpenedDocuments } from './engine/vscodeQueries';
import { PanelManager } from './panel';
import { forgetDocument } from './symbols';

// Activation only registers things. Nothing scans the workspace.
/** Returned from activate() so integration tests can drive the panel without clicking. */
export interface ProphasisTestApi {
  panels: PanelManager;
}

export function activate(context: vscode.ExtensionContext): ProphasisTestApi {
  const panels = new PanelManager(context.extensionUri, context.globalState);
  let lastArgs: unknown[] = [];
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
      // From the command palette, remember the cursor so Retry asks about the same place.
      lastArgs = args.length > 0 ? args : cursorArgs();
      await showFlow(panels, current.token, lastArgs);
    }),
    panels.onDidRequestRetry(() => vscode.commands.executeCommand(SHOW_FLOW, ...lastArgs)),
    vscode.workspace.onDidCloseTextDocument((document) => forgetDocument(document.uri)),
  );
  return { panels };
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
        if (started.graph && started.status !== 'languageServerStarting') {
          await loadDeeper(builder, started.graph.rootId, depth);
        }
        return { status: started.status, graph: started.graph && builder.snapshot() };
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
    panels.show({
      title: root?.name ?? 'Show flow',
      status: result.status,
      builder: result.graph ? builder : undefined,
      sourceColumn: target.column,
    });
  } catch (error) {
    if (error instanceof CancelledError) {
      return;
    }
    const message =
      error instanceof QueryTimeoutError
        ? 'The language server took too long to answer. It may still be indexing the project; try again in a moment.'
        : `Something went wrong: ${String(error)}`;
    panels.show({ title: 'Show flow', status: 'error', message, sourceColumn: target.column });
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

interface Target {
  uri: vscode.Uri;
  position: vscode.Position;
  /** The editor column the click came from. */
  column?: vscode.ViewColumn;
}

function readTarget(args: unknown[]): Target | undefined {
  const [first, second, third] = args;
  if (typeof first !== 'string' || typeof second !== 'number' || typeof third !== 'number') {
    return undefined;
  }
  const uri = vscode.Uri.parse(first, true);
  const column = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  )?.viewColumn;
  return { uri, position: new vscode.Position(second, third), column };
}

/** The cursor position, in the same (uri, line, character) form the CodeLens uses. */
function cursorArgs(): unknown[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return [];
  }
  const at = editor.selection.active;
  return [editor.document.uri.toString(), at.line, at.character];
}
