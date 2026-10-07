import * as vscode from 'vscode';
import {
  isAnonymousCallback,
  isValueKind,
  looksLikeFunctionValue,
  toNodeKind,
} from './engine/kinds';

/** A symbol that can be a starting point: a function, method, class-like type or a variable holding a function. */
export interface StartSymbol {
  name: string;
  kind: vscode.SymbolKind;
  /** The whole declaration, body included. */
  range: vscode.Range;
  /** Where the name is written; the call hierarchy is asked at this position. */
  selectionRange: vscode.Range;
}

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
    collect(document, item, symbols);
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

function canStart(
  document: vscode.TextDocument,
  name: string,
  kind: vscode.SymbolKind,
  nameRange: vscode.Range,
): boolean {
  const kindName = vscode.SymbolKind[kind];
  // Enums have no calls; until "used by" exists (Phase 4) a button on them is noise.
  if (isAnonymousCallback(name) || kindName === 'Enum') {
    return false;
  }
  if (toNodeKind(kindName)) {
    return true;
  }
  if (!isValueKind(kindName)) {
    return false;
  }
  const end = nameRange.end;
  return looksLikeFunctionValue(document.lineAt(end.line).text.slice(end.character));
}

// Language servers return either a tree (DocumentSymbol) or a flat list
// (SymbolInformation). Both are handled.
function collect(
  document: vscode.TextDocument,
  item: vscode.DocumentSymbol | vscode.SymbolInformation,
  out: StartSymbol[],
): void {
  if ('children' in item) {
    if (canStart(document, item.name, item.kind, item.selectionRange)) {
      out.push({
        name: item.name,
        kind: item.kind,
        range: item.range,
        selectionRange: item.selectionRange,
      });
    }
    for (const child of item.children) {
      collect(document, child, out);
    }
  } else {
    // A flat list only gives the whole range, so a variable can't be checked: skip it.
    const range = item.location.range;
    if (toNodeKind(vscode.SymbolKind[item.kind]) && !isAnonymousCallback(item.name)) {
      out.push({ name: item.name, kind: item.kind, range, selectionRange: range });
    }
  }
}
