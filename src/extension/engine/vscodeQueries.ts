import * as vscode from 'vscode';
import {
  CancelledError,
  QueryTimeoutError,
  type CallItem,
  type CallLink,
  type DocSymbol,
  type LanguageQueries,
  type Pos,
  type Span,
} from './queries';

/** Every request to a language server gives up after this long. */
export const QUERY_TIMEOUT_MS = 5000;
/** How long after opening a file an empty answer means "still starting". Phase 1 measured up to 10 s. */
const STARTUP_WINDOW_MS = 30_000;

const openedAt = new Map<string, number>();

/** Remembers when files were opened, so "still starting" can be told apart from "not supported". */
export function trackOpenedDocuments(): vscode.Disposable {
  for (const document of vscode.workspace.textDocuments) {
    openedAt.set(document.uri.toString(), Date.now());
  }
  return vscode.Disposable.from(
    vscode.workspace.onDidOpenTextDocument((d) => openedAt.set(d.uri.toString(), Date.now())),
    vscode.workspace.onDidCloseTextDocument((d) => openedAt.delete(d.uri.toString())),
  );
}

/** Language queries through VS Code's built-in commands, cancelled by `token`. */
export function createVscodeQueries(token: vscode.CancellationToken): LanguageQueries {
  const run = async <T>(what: string, command: string, ...args: unknown[]): Promise<T> => {
    if (token.isCancellationRequested) {
      throw new CancelledError();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onCancel: vscode.Disposable | undefined;
    try {
      return await Promise.race([
        Promise.resolve(vscode.commands.executeCommand<T>(command, ...args)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new QueryTimeoutError(what)), QUERY_TIMEOUT_MS);
          onCancel = token.onCancellationRequested(() => reject(new CancelledError()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
      onCancel?.dispose();
    }
  };

  const document = (uri: string) => vscode.workspace.openTextDocument(vscode.Uri.parse(uri, true));

  return {
    async documentSymbols(uri) {
      const result = await run<(vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined>(
        'Reading symbols',
        'vscode.executeDocumentSymbolProvider',
        vscode.Uri.parse(uri, true),
      );
      return (result ?? []).map(toDocSymbol);
    },

    async prepareCallHierarchy(uri, pos) {
      const items = await run<vscode.CallHierarchyItem[] | undefined>(
        'Finding the symbol',
        'vscode.prepareCallHierarchy',
        vscode.Uri.parse(uri, true),
        new vscode.Position(pos.line, pos.character),
      );
      return (items ?? []).map(toCallItem);
    },

    async outgoingCalls(item) {
      const calls = await run<vscode.CallHierarchyOutgoingCall[] | undefined>(
        'Finding calls',
        'vscode.provideOutgoingCalls',
        item.handle,
      );
      return (calls ?? []).map((c) => ({
        item: toCallItem(c.to),
        ranges: c.fromRanges.map(toSpan),
      }));
    },

    async incomingCalls(item) {
      const calls = await run<vscode.CallHierarchyIncomingCall[] | undefined>(
        'Finding callers',
        'vscode.provideIncomingCalls',
        item.handle,
      );
      return (calls ?? []).map((c): CallLink => ({
        item: toCallItem(c.from),
        ranges: c.fromRanges.map(toSpan),
      }));
    },

    async lineText(uri, line) {
      const doc = await document(uri);
      return line < doc.lineCount ? doc.lineAt(line).text : '';
    },

    fileVersion(uri) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
      return doc?.version ?? 0;
    },

    openedRecently(uri) {
      const at = openedAt.get(uri);
      return at !== undefined && Date.now() - at < STARTUP_WINDOW_MS;
    },

    workspacePath(uri) {
      const parsed = vscode.Uri.parse(uri, true);
      if (!vscode.workspace.getWorkspaceFolder(parsed)) {
        return undefined;
      }
      return vscode.workspace.asRelativePath(parsed, true);
    },
  };
}

function toPos(p: vscode.Position): Pos {
  return { line: p.line, character: p.character };
}

function toSpan(r: vscode.Range): Span {
  return { start: toPos(r.start), end: toPos(r.end) };
}

function toCallItem(item: vscode.CallHierarchyItem): CallItem {
  return {
    name: item.name,
    kind: vscode.SymbolKind[item.kind],
    uri: item.uri.toString(),
    range: toSpan(item.range),
    selectionRange: toSpan(item.selectionRange),
    handle: item,
  };
}

function toDocSymbol(item: vscode.DocumentSymbol | vscode.SymbolInformation): DocSymbol {
  if ('children' in item) {
    return {
      name: item.name,
      kind: vscode.SymbolKind[item.kind],
      range: toSpan(item.range),
      selectionRange: toSpan(item.selectionRange),
      children: item.children.map(toDocSymbol),
    };
  }
  // A flat list has no nesting; each entry becomes a top-level symbol.
  const span = toSpan(item.location.range);
  return {
    name: item.name,
    kind: vscode.SymbolKind[item.kind],
    range: span,
    selectionRange: span,
    children: [],
  };
}
