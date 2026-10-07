// What the graph builder needs from the editor, as plain data. The real
// implementation wraps VS Code's commands (vscodeQueries.ts); unit tests use a
// fake. Nothing in engine/ except vscodeQueries.ts may import 'vscode'.

export interface Pos {
  /** 0-based, like VS Code. */
  line: number;
  character: number;
}

export interface Span {
  start: Pos;
  end: Pos;
}

/** VS Code's SymbolKind names, as reported by language servers. */
export type SymbolKindName = string;

export interface DocSymbol {
  name: string;
  kind: SymbolKindName;
  range: Span;
  selectionRange: Span;
  children: DocSymbol[];
}

/** A call hierarchy item. `handle` is the original object, passed back unchanged. */
export interface CallItem {
  name: string;
  kind: SymbolKindName;
  uri: string;
  range: Span;
  selectionRange: Span;
  handle: unknown;
}

export interface CallLink {
  item: CallItem;
  /** Where the call is written, in the caller's file. */
  ranges: Span[];
}

export interface LanguageQueries {
  documentSymbols(uri: string): Promise<DocSymbol[]>;
  prepareCallHierarchy(uri: string, pos: Pos): Promise<CallItem[]>;
  outgoingCalls(item: CallItem): Promise<CallLink[]>;
  incomingCalls(item: CallItem): Promise<CallLink[]>;
  /** Text of one line, for the one-line signature. */
  lineText(uri: string, line: number): Promise<string>;
  /** Changes whenever the file's contents change. */
  fileVersion(uri: string): number;
  /** True shortly after the file was opened, while its language server may still be starting. */
  openedRecently(uri: string): boolean;
  /** Workspace-relative path, or undefined when outside every workspace folder. */
  workspacePath(uri: string): string | undefined;
}

/** Thrown when a language server takes longer than the timeout. */
export class QueryTimeoutError extends Error {
  constructor(what: string) {
    super(`${what} took too long`);
    this.name = 'QueryTimeoutError';
  }
}

/** Thrown when the panel closed or a newer request replaced this one. */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}
