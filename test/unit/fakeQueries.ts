// An in-memory stand-in for VS Code's language queries, so the graph builder
// can be tested without starting VS Code.
import type {
  CallItem,
  CallLink,
  DocSymbol,
  LanguageQueries,
  Place,
  Pos,
  Span,
} from '../../src/extension/engine/queries';

export const WORKSPACE = 'file:///work/';

export interface FakeFile {
  lines: string[];
  symbols: DocSymbol[];
}

export interface FakeProject {
  files: Record<string, FakeFile>;
  /** Outgoing calls by caller name: [callee name, call positions]. */
  calls: Record<string, [string, Pos[]][]>;
  /** References by symbol name: [file uri, position]. */
  references?: Record<string, [string, Pos][]>;
  /** Parent types by type name. */
  parents?: Record<string, string[]>;
  /** False imitates TypeScript: no type hierarchy, children only through implementations. */
  typeHierarchy?: boolean;
  /** Hover text by symbol name, as a language server would return it. */
  docs?: Record<string, string>;
}

export function pos(line: number, character: number): Pos {
  return { line, character };
}

/** A symbol whose name starts at (line, column) and whose body ends on `endLine`. */
export function sym(
  name: string,
  kind: string,
  line: number,
  column: number,
  endLine = line,
  children: DocSymbol[] = [],
): DocSymbol {
  return {
    name,
    kind,
    selectionRange: { start: pos(line, column), end: pos(line, column + name.length) },
    range: { start: pos(line, 0), end: pos(endLine, 200) },
    children,
  };
}

export class FakeQueries implements LanguageQueries {
  version = 1;
  recentlyOpened = false;
  calls = { outgoing: 0, incoming: 0 };

  constructor(private readonly project: FakeProject) {}

  async documentSymbols(uri: string): Promise<DocSymbol[]> {
    return this.project.files[uri]?.symbols ?? [];
  }

  async prepareCallHierarchy(uri: string, at: Pos): Promise<CallItem[]> {
    const found = this.find((u, s) => u === uri && within(s.selectionRange, at));
    return found ? [found] : [];
  }

  async outgoingCalls(item: CallItem): Promise<CallLink[]> {
    this.calls.outgoing++;
    return (this.project.calls[item.name] ?? []).map(([callee, at]) => ({
      item: this.byName(callee),
      ranges: at.map((p) => ({ start: p, end: pos(p.line, p.character + callee.length) })),
    }));
  }

  async incomingCalls(item: CallItem): Promise<CallLink[]> {
    this.calls.incoming++;
    const links: CallLink[] = [];
    for (const [caller, callees] of Object.entries(this.project.calls)) {
      for (const [callee, at] of callees) {
        if (callee === item.name) {
          links.push({
            item: this.byName(caller),
            ranges: at.map((p) => ({ start: p, end: pos(p.line, p.character + callee.length) })),
          });
        }
      }
    }
    return links;
  }

  async references(uri: string, at: Pos): Promise<Place[]> {
    const symbol = await this.prepareCallHierarchy(uri, at);
    const name = symbol[0]?.name ?? '';
    return (this.project.references?.[name] ?? []).map(([file, p]) => ({
      uri: file,
      range: { start: p, end: pos(p.line, p.character + name.length) },
    }));
  }

  async implementations(uri: string, at: Pos): Promise<Place[]> {
    const [self] = await this.prepareCallHierarchy(uri, at);
    if (!self) {
      return [];
    }
    // Like TypeScript: the type itself plus everything that extends it.
    return [self, ...this.children(self.name)].map((item) => ({
      uri: item.uri,
      range: item.selectionRange,
    }));
  }

  async prepareTypeHierarchy(uri: string, at: Pos): Promise<CallItem[]> {
    return this.project.typeHierarchy === false ? [] : this.prepareCallHierarchy(uri, at);
  }

  async supertypes(item: CallItem): Promise<CallItem[]> {
    return (this.project.parents?.[item.name] ?? []).map((name) => this.byName(name));
  }

  async subtypes(item: CallItem): Promise<CallItem[]> {
    return this.children(item.name);
  }

  private children(name: string): CallItem[] {
    return Object.entries(this.project.parents ?? {})
      .filter(([, parents]) => parents.includes(name))
      .map(([child]) => this.byName(child));
  }

  async text(uri: string, span: Span): Promise<string> {
    const lines = this.project.files[uri]?.lines ?? [];
    return lines.slice(span.start.line, span.end.line + 1).join('\n');
  }

  async hover(uri: string, at: Pos): Promise<string> {
    const [item] = await this.prepareCallHierarchy(uri, at);
    return item ? (this.project.docs?.[item.name] ?? '') : '';
  }

  async lineText(uri: string, line: number): Promise<string> {
    return this.project.files[uri]?.lines[line] ?? '';
  }

  fileVersion(): number {
    return this.version;
  }

  openedRecently(): boolean {
    return this.recentlyOpened;
  }

  workspacePath(uri: string): string | undefined {
    return uri.startsWith(WORKSPACE) ? uri.slice(WORKSPACE.length) : undefined;
  }

  private byName(name: string): CallItem {
    const found = this.find((_, s) => s.name === name);
    if (!found) {
      throw new Error(`fake project has no symbol named ${name}`);
    }
    return found;
  }

  private find(test: (uri: string, s: DocSymbol) => boolean): CallItem | undefined {
    for (const [uri, file] of Object.entries(this.project.files)) {
      const stack = [...file.symbols];
      for (let s = stack.shift(); s; s = stack.shift()) {
        if (test(uri, s)) {
          return {
            name: s.name,
            kind: s.kind,
            uri,
            range: s.range,
            selectionRange: s.selectionRange,
            handle: s,
          };
        }
        stack.push(...s.children);
      }
    }
    return undefined;
  }
}

function within(span: Span, at: Pos): boolean {
  const after =
    at.line > span.start.line ||
    (at.line === span.start.line && at.character >= span.start.character);
  const before =
    at.line < span.end.line || (at.line === span.end.line && at.character <= span.end.character);
  return after && before;
}
