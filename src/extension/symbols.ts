import * as vscode from 'vscode';

/** A symbol that can be a starting point: a function, method or class-like type. */
export interface StartSymbol {
  name: string;
  kind: vscode.SymbolKind;
  /** The whole declaration, body included. */
  range: vscode.Range;
  /** Where the name is written; the call hierarchy is asked at this position. */
  selectionRange: vscode.Range;
}

const startKinds = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Struct,
]);

// Keyed by document URI. An entry is only valid for the document version it was
// built from, so an edited file is never served stale symbols.
const cache = new Map<string, { version: number; symbols: StartSymbol[] }>();

export async function getStartSymbols(document: vscode.TextDocument): Promise<StartSymbol[]> {
  const key = document.uri.toString();
  const cached = cache.get(key);
  if (cached && cached.version === document.version) {
    return cached.symbols;
  }

  const result = await vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
  >('vscode.executeDocumentSymbolProvider', document.uri);

  const symbols: StartSymbol[] = [];
  for (const item of result ?? []) {
    collect(item, symbols);
  }
  // A language server that is still starting answers with nothing. Caching that
  // would hide the buttons until the file is edited, so empty answers aren't kept.
  if (result && result.length > 0) {
    cache.set(key, { version: document.version, symbols });
  }
  return symbols;
}

export function forgetDocument(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}

// Language servers return either a tree (DocumentSymbol) or a flat list
// (SymbolInformation). Both are handled.
function collect(item: vscode.DocumentSymbol | vscode.SymbolInformation, out: StartSymbol[]): void {
  if ('children' in item) {
    if (startKinds.has(item.kind) && !isAnonymousCallback(item.name)) {
      out.push({
        name: item.name,
        kind: item.kind,
        range: item.range,
        selectionRange: item.selectionRange,
      });
    }
    for (const child of item.children) {
      collect(child, out);
    }
  } else if (startKinds.has(item.kind)) {
    const range = item.location.range;
    out.push({ name: item.name, kind: item.kind, range, selectionRange: range });
  }
}

// TypeScript lists inline callbacks as functions named like
// "items.reduce() callback". A button on each of them is noise.
function isAnonymousCallback(name: string): boolean {
  return name.endsWith(') callback');
}

/** The innermost start symbol that contains the position, if any. */
export function symbolAt(
  symbols: StartSymbol[],
  position: vscode.Position,
): StartSymbol | undefined {
  let best: StartSymbol | undefined;
  for (const s of symbols) {
    if (s.range.contains(position) && (!best || best.range.contains(s.range))) {
      best = s;
    }
  }
  return best;
}
