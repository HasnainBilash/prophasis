import picomatch from 'picomatch';
import type {
  EdgeKind,
  FlowEdge,
  FlowGraph,
  FlowNode,
  GraphPatch,
  GraphStatus,
  MemberRow,
  NodeKind,
  Relation,
} from '../../shared/types';
import { LruCache } from './cache';
import {
  isAnonymousCallback,
  isClassLike,
  isValueKind,
  looksLikeFunctionValue,
  toNodeKind,
} from './kinds';
import type { CallItem, CallLink, DocSymbol, LanguageQueries, Pos, Span } from './queries';

export interface BuilderOptions {
  maxCards: number;
  showExternalCode: boolean;
  excludeGlobs: string[];
}

export const DEFAULT_OPTIONS: BuilderOptions = {
  maxCards: 150,
  showExternalCode: false,
  excludeGlobs: [],
};

const ZERO: Pos = { line: 0, character: 0 };

/** New cards one expansion may add before the rest go into a "+N more" card. */
export const FAN_OUT = 12;

/** Rows shown on a class card before "+N more". */
export const MAX_MEMBER_ROWS = 40;
/** Signatures are cut to one line of this length. */
export const MAX_SIGNATURE = 120;

export interface StartResult {
  status: GraphStatus;
  graph?: FlowGraph;
}

/** Where a node's symbol lives, kept in the host only (the panel gets workspace paths). */
interface Location {
  uri: string;
  pos: Pos;
  /** The call hierarchy item, once known. */
  item?: CallItem;
}

interface Resolved {
  node: FlowNode;
  location: Location;
}

/** A symbol connected to the card being expanded, and how. */
interface Target {
  other: Resolved;
  /** 'out': the arrow goes from the expanded card to `other`. */
  direction: 'out' | 'in';
  kind: EdgeKind;
  lines: number[];
}

// Shared by every builder in the window. Keyed by node id, relation and file
// version, so an edited file never gets old answers.
const callCache = new LruCache<CallLink[]>(500);

/** Empties the shared call cache (used by tests). */
export function clearCallCache(): void {
  callCache.clear();
}

/**
 * Builds and grows one panel's graph. Every method that asks a language server
 * can throw QueryTimeoutError or CancelledError; the caller turns those into a
 * status message.
 */
export class GraphBuilder {
  private readonly nodes = new Map<string, FlowNode>();
  private readonly edges = new Map<string, FlowEdge>();
  private readonly locations = new Map<string, Location>();
  private readonly symbolCache = new Map<string, { version: number; symbols: DocSymbol[] }>();
  private readonly isExcluded: (path: string) => boolean;
  private rootId = '';
  private hiddenCount = 0;

  constructor(
    private readonly queries: LanguageQueries,
    private readonly options: BuilderOptions = DEFAULT_OPTIONS,
  ) {
    const matchers = options.excludeGlobs.map((glob) => picomatch(glob, { dot: true }));
    this.isExcluded = (path) => matchers.some((match) => match(path));
  }

  /** Builds the first graph: the start card plus one level (its calls, or a class's members). */
  async start(uri: string, pos: Pos): Promise<StartResult> {
    const symbols = await this.symbolsOf(uri);
    if (symbols.length === 0) {
      return {
        status: this.queries.openedRecently(uri) ? 'languageServerStarting' : 'unsupported',
      };
    }
    const chain = await this.startChainAt(uri, symbols, pos);
    if (!chain) {
      return { status: 'noSymbol' };
    }

    const root = await this.resolveChain(uri, chain);
    this.addNode(root.node, root.location, true);
    this.rootId = root.node.id;

    let status: GraphStatus = 'ok';
    if (isClassLike(root.node.kind)) {
      root.node.expanded.push('contains');
    } else {
      const item = await this.itemFor(root.node.id);
      if (!item) {
        status = this.queries.openedRecently(uri) ? 'languageServerStarting' : 'unsupported';
      } else {
        const patch = await this.expand(root.node.id, 'calls');
        if (patch.addEdges.length === 0 && !root.node.isRecursive) {
          status = 'empty';
        }
      }
    }
    return { status, graph: this.snapshot() };
  }

  /**
   * Loads one relationship of a card, one level deep. A member row of a class
   * card can be expanded too: it becomes its own card inside the class.
   * At most FAN_OUT new cards are added; the rest are counted in `more` and
   * added when `all` is true (the "+N more" card).
   */
  async expand(nodeId: string, relation: Relation, all = false): Promise<GraphPatch> {
    const patch: GraphPatch = {
      addNodes: [],
      addEdges: [],
      updateNodes: [],
      removeIds: [],
      hiddenCount: this.hiddenCount,
    };
    const node = await this.ensureMemberNode(nodeId, patch);
    if (!node) {
      return patch;
    }

    let targets: Target[] = [];
    if (relation === 'calls' || relation === 'calledBy') {
      targets = await this.callTargets(node, relation);
    } else if (relation === 'usedBy') {
      targets = await this.usageTargets(node);
    } else if (relation === 'extends') {
      targets = await this.typeTargets(node);
    }
    // "contains" is shown as member rows from the start.

    let order = 0;
    let added = 0;
    let more = 0;
    const touched = new Set<FlowNode>();
    for (const target of targets) {
      const other = target.other;
      if (!this.isVisible(other.node)) {
        continue;
      }
      if (other.node.id === node.id) {
        if (relation === 'calls' || relation === 'calledBy') {
          node.isRecursive = true;
          touched.add(node);
        }
        continue;
      }

      let card = this.nodes.get(other.node.id);
      if (!card) {
        if (!all && added >= FAN_OUT) {
          more++;
          continue;
        }
        if (this.nodes.size >= this.options.maxCards) {
          this.hiddenCount++;
          continue;
        }
        card = other.node;
        this.addNode(card, other.location);
        patch.addNodes.push(card);
        added++;
      }

      const outward = target.direction === 'out';
      const fromId = outward ? node.id : card.id;
      const toId = outward ? card.id : node.id;
      const edge =
        target.kind === 'calls' || target.kind === 'calledBy'
          ? this.upsertCallEdge(fromId, toId, target.kind, ++order, target.lines)
          : this.upsertEdge(fromId, toId, target.kind, target.lines);
      if (!edge) {
        continue;
      }
      patch.addEdges.push(edge);
      const isCall = edge.kind === 'calls' || edge.kind === 'calledBy';
      if (isCall && this.reaches(toId, fromId)) {
        const closing = this.nodes.get(toId);
        if (closing && !closing.isRecursive) {
          closing.isRecursive = true;
          touched.add(closing);
        }
      }
    }

    if (!node.expanded.includes(relation)) {
      node.expanded.push(relation);
    }
    const counts: Partial<Record<Relation, number>> = Object.fromEntries(
      Object.entries(node.more ?? {}).filter(([key]) => key !== relation),
    );
    if (more > 0) {
      counts[relation] = more;
    }
    node.more = Object.keys(counts).length > 0 ? counts : undefined;
    touched.add(node);
    patch.updateNodes = [...touched].filter((n) => !patch.addNodes.includes(n));
    patch.hiddenCount = this.hiddenCount;
    return patch;
  }

  /** Calls or callers, in the order the calls are written in the caller. */
  private async callTargets(node: FlowNode, relation: 'calls' | 'calledBy'): Promise<Target[]> {
    const item = await this.itemFor(node.id);
    const links = item ? await this.callLinks(node, item, relation) : [];
    // Outgoing call positions are in the caller's file, so they give the order
    // calls appear in the code. Duplicates (seen in Phase 1) are removed first.
    const prepared = links
      .map((link) => {
        const ranges = uniqueSpans(link.ranges);
        // A call's position is its callee expression (`this.save`,
        // `getPlugin(x).generate`), so where it ends is where the called name is
        // written: that gives reading order, also for chained and nested calls.
        const first = ranges.map((r) => r.end).sort(comparePos)[0];
        return { link, ranges, first };
      })
      .filter((entry) => entry.first !== undefined)
      .sort((a, b) => comparePos(a.first ?? ZERO, b.first ?? ZERO));
    const resolved = await Promise.all(prepared.map((entry) => this.resolveItem(entry.link.item)));
    const targets: Target[] = [];
    for (const [index, entry] of prepared.entries()) {
      const other = resolved[index];
      if (other) {
        targets.push({
          other,
          direction: relation === 'calls' ? 'out' : 'in',
          kind: relation,
          lines: [...new Set(entry.ranges.map((r) => r.start.line + 1))],
        });
      }
    }
    return targets;
  }

  /**
   * Places that reference the symbol, grouped by the function, method or class
   * they are written in. References outside any of those (imports, top-level
   * code) have no card to belong to and are left out.
   */
  private async usageTargets(node: FlowNode): Promise<Target[]> {
    const location = this.locations.get(node.id);
    if (!location) {
      return [];
    }
    const places = await this.queries.references(location.uri, location.pos);
    const byUser = new Map<string, { chain: DocSymbol[]; uri: string; lines: Set<number> }>();
    for (const place of places) {
      const isDeclaration =
        place.uri === location.uri && comparePos(place.range.start, location.pos) === 0;
      if (isDeclaration || !this.isVisiblePath(place.uri)) {
        continue;
      }
      const symbols = await this.symbolsOf(place.uri);
      const chain = await this.startChainAt(place.uri, symbols, place.range.start);
      const user = chain?.[chain.length - 1];
      if (!chain || !user) {
        continue;
      }
      const at = user.selectionRange.start;
      const key = place.uri + '#' + at.line + ':' + at.character;
      const entry = byUser.get(key) ?? { chain, uri: place.uri, lines: new Set<number>() };
      entry.lines.add(place.range.start.line + 1);
      byUser.set(key, entry);
    }
    const targets: Target[] = [];
    for (const { chain, uri, lines } of byUser.values()) {
      const other = await this.resolveChain(uri, chain);
      const sorted = [...lines].sort((a, b) => a - b);
      targets.push({ other, direction: 'in', kind: 'usedBy', lines: sorted });
    }
    return targets;
  }

  /**
   * Parent and child types. Where the language has a type hierarchy (Python),
   * both directions come from it; otherwise (TypeScript, JavaScript) only
   * children are known, from the implementation provider.
   */
  private async typeTargets(node: FlowNode): Promise<Target[]> {
    const location = this.locations.get(node.id);
    if (!location || !isClassLike(node.kind)) {
      return [];
    }
    const kindFor = (parent: NodeKind): EdgeKind =>
      parent === 'interface' ? 'implements' : 'extends';
    const targets: Target[] = [];
    const [item] = await this.queries.prepareTypeHierarchy(location.uri, location.pos);
    if (item) {
      for (const parent of await this.queries.supertypes(item)) {
        const other = await this.resolveItem(parent);
        if (other) {
          targets.push({ other, direction: 'out', kind: kindFor(other.node.kind), lines: [] });
        }
      }
      for (const child of await this.queries.subtypes(item)) {
        const other = await this.resolveItem(child);
        if (other) {
          targets.push({ other, direction: 'in', kind: kindFor(node.kind), lines: [] });
        }
      }
      return targets;
    }
    for (const place of await this.queries.implementations(location.uri, location.pos)) {
      if (!this.isVisiblePath(place.uri)) {
        continue;
      }
      const chain = chainAt(await this.symbolsOf(place.uri), place.range.start);
      if (!chain) {
        continue;
      }
      const other = await this.resolveChain(place.uri, chain);
      // The implementations of a type include the type itself; expand() skips it.
      if (isClassLike(other.node.kind)) {
        targets.push({ other, direction: 'in', kind: kindFor(node.kind), lines: [] });
      }
    }
    return targets;
  }

  /**
   * Hides what one expansion showed. Its arrows go, except those another
   * expansion also accounts for (the other card's own Calls or Called by);
   * then every card no longer connected to the start card goes too.
   */
  collapse(nodeId: string, relation: Relation): GraphPatch {
    const patch: GraphPatch = {
      addNodes: [],
      addEdges: [],
      updateNodes: [],
      removeIds: [],
      hiddenCount: this.hiddenCount,
    };
    const node = this.nodes.get(nodeId);
    if (!node || !node.expanded.includes(relation)) {
      return patch;
    }
    node.expanded = node.expanded.filter((r) => r !== relation);
    if (node.more) {
      const counts = Object.entries(node.more).filter(([key]) => key !== relation);
      node.more = counts.length > 0 ? Object.fromEntries(counts) : undefined;
    }
    patch.updateNodes.push(node);

    for (const edge of [...this.edges.values()]) {
      if (!this.belongsTo(edge, nodeId, relation)) {
        continue;
      }
      // A call arrow is also accounted for by the other card's own expansion.
      if (edge.kind === 'calls' || edge.kind === 'calledBy') {
        const otherId = relation === 'calls' ? edge.toId : edge.fromId;
        const otherNeeds = relation === 'calls' ? 'calledBy' : 'calls';
        if (this.nodes.get(otherId)?.expanded.includes(otherNeeds)) {
          continue;
        }
      }
      this.edges.delete(edge.id);
      patch.removeIds.push(edge.id);
    }

    // Keep everything still connected to the start card; arrows count both ways,
    // and a member stays as long as its class card does.
    const keep = new Set<string>([this.rootId]);
    const queue = [this.rootId];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const neighbours: string[] = [];
      for (const edge of this.edges.values()) {
        if (edge.fromId === id) neighbours.push(edge.toId);
        if (edge.toId === id) neighbours.push(edge.fromId);
      }
      for (const other of this.nodes.values()) {
        if (other.parentId === id || this.nodes.get(id)?.parentId === other.id) {
          neighbours.push(other.id);
        }
      }
      for (const next of neighbours) {
        if (!keep.has(next) && this.nodes.has(next)) {
          keep.add(next);
          queue.push(next);
        }
      }
    }
    for (const id of [...this.nodes.keys()]) {
      if (keep.has(id)) {
        continue;
      }
      this.nodes.delete(id);
      patch.removeIds.push(id);
      for (const edge of [...this.edges.values()]) {
        if (edge.fromId === id || edge.toId === id) {
          this.edges.delete(edge.id);
          patch.removeIds.push(edge.id);
        }
      }
    }
    return patch;
  }

  snapshot(): FlowGraph {
    return {
      rootId: this.rootId,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      hiddenCount: this.hiddenCount,
      truncated: this.hiddenCount > 0,
    };
  }

  /** The editor location of a card, for click-to-jump. */
  locationOf(nodeId: string): { uri: string; pos: Pos } | undefined {
    const location = this.locations.get(nodeId);
    return location && { uri: location.uri, pos: location.pos };
  }

  // ---- edges -------------------------------------------------------------

  /**
   * One edge per caller/callee pair. An edge found through "called by" has no
   * order number; if the caller's own calls are loaded later, it becomes a
   * numbered "calls" edge. Returns the edge if it is new or changed.
   */
  private upsertCallEdge(
    fromId: string,
    toId: string,
    relation: 'calls' | 'calledBy',
    order: number,
    callLines: number[],
  ): FlowEdge | undefined {
    const id = `${fromId}->${toId}`;
    const existing = this.edges.get(id);
    if (existing) {
      if (relation === 'calls' && existing.kind === 'calledBy') {
        const upgraded: FlowEdge = { ...existing, kind: 'calls', order, callLines };
        this.edges.set(id, upgraded);
        return upgraded;
      }
      return undefined;
    }
    const edge: FlowEdge = {
      id,
      fromId,
      toId,
      kind: relation,
      order: relation === 'calls' ? order : 0,
      callLines,
    };
    this.edges.set(id, edge);
    return edge;
  }

  /** Whether an arrow was shown by expanding `relation` on the card `nodeId`. */
  private belongsTo(edge: FlowEdge, nodeId: string, relation: Relation): boolean {
    switch (relation) {
      case 'calls':
        return edge.kind === 'calls' && edge.fromId === nodeId;
      case 'calledBy':
        return (edge.kind === 'calls' || edge.kind === 'calledBy') && edge.toId === nodeId;
      case 'usedBy':
        return edge.kind === 'usedBy' && edge.toId === nodeId;
      case 'extends':
        return (
          (edge.kind === 'extends' || edge.kind === 'implements') &&
          (edge.fromId === nodeId || edge.toId === nodeId)
        );
      default:
        return false;
    }
  }

  /** Edges other than calls: one per pair and kind, never numbered. */
  private upsertEdge(
    fromId: string,
    toId: string,
    kind: EdgeKind,
    lines: number[],
  ): FlowEdge | undefined {
    const id = `${fromId}->${toId}#${kind}`;
    if (this.edges.has(id)) {
      return undefined;
    }
    const edge: FlowEdge = { id, fromId, toId, kind, order: 0, callLines: lines };
    this.edges.set(id, edge);
    return edge;
  }

  /** Whether `toId` can be reached from `fromId` by following call arrows. */
  private reaches(fromId: string, toId: string): boolean {
    const seen = new Set<string>([fromId]);
    const queue = [fromId];
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      if (current === toId) {
        return true;
      }
      for (const edge of this.edges.values()) {
        if (
          edge.fromId === current &&
          (edge.kind === 'calls' || edge.kind === 'calledBy') &&
          !seen.has(edge.toId)
        ) {
          seen.add(edge.toId);
          queue.push(edge.toId);
        }
      }
    }
    return false;
  }

  // ---- nodes -------------------------------------------------------------

  private addNode(node: FlowNode, location: Location, force = false): void {
    if (!force && this.nodes.size >= this.options.maxCards) {
      return;
    }
    this.nodes.set(node.id, node);
    if (!this.locations.has(node.id) || location.item) {
      this.locations.set(node.id, location);
    }
  }

  /** Whether a file's symbols may appear, checked before reading it (skips library files). */
  private isVisiblePath(uri: string): boolean {
    const path = this.queries.workspacePath(uri);
    if (path === undefined) {
      return this.options.showExternalCode;
    }
    return !this.isExcluded(path);
  }

  private isVisible(node: FlowNode): boolean {
    if (node.isExternal) {
      return this.options.showExternalCode;
    }
    return !this.isExcluded(node.filePath);
  }

  /**
   * Member rows have ids but are not cards yet. Expanding one makes it a card
   * that sits inside its class, joined by a "contains" edge.
   */
  private async ensureMemberNode(nodeId: string, patch: GraphPatch): Promise<FlowNode | undefined> {
    const existing = this.nodes.get(nodeId);
    if (existing) {
      return existing;
    }
    const location = this.locations.get(nodeId);
    if (!location) {
      return undefined;
    }
    const symbols = await this.symbolsOf(location.uri);
    const chain = chainAt(symbols, location.pos);
    if (!chain) {
      return undefined;
    }
    const resolved = await this.resolveChain(location.uri, chain);
    const node = resolved.node;
    this.addNode(node, resolved.location, true);
    patch.addNodes.push(node);
    if (node.parentId && this.nodes.has(node.parentId)) {
      const edge: FlowEdge = {
        id: `${node.parentId}->${node.id}`,
        fromId: node.parentId,
        toId: node.id,
        kind: 'contains',
        order: 0,
        callLines: [],
      };
      this.edges.set(edge.id, edge);
      patch.addEdges.push(edge);
    }
    return node;
  }

  /** The call hierarchy item for a card, asked for once and then remembered. */
  private async itemFor(nodeId: string): Promise<CallItem | undefined> {
    const location = this.locations.get(nodeId);
    if (!location) {
      return undefined;
    }
    if (!location.item) {
      const items = await this.queries.prepareCallHierarchy(location.uri, location.pos);
      location.item = items[0];
    }
    return location.item;
  }

  private async callLinks(
    node: FlowNode,
    item: CallItem,
    relation: 'calls' | 'calledBy',
  ): Promise<CallLink[]> {
    // Version 0 means the file isn't loaded, so changes can't be seen: don't cache.
    const version = this.queries.fileVersion(item.uri);
    const key = `${relation}|${node.id}|${version}`;
    const cached = version > 0 ? callCache.get(key) : undefined;
    if (cached) {
      return cached;
    }
    const links =
      relation === 'calls'
        ? await this.queries.outgoingCalls(item)
        : await this.queries.incomingCalls(item);
    // Empty answers aren't kept either: a server that is still warming up answers
    // with nothing, and that must not stick until the file is edited.
    if (version > 0 && links.length > 0) {
      callCache.set(key, links);
    }
    return links;
  }

  // ---- symbols -----------------------------------------------------------

  private async symbolsOf(uri: string): Promise<DocSymbol[]> {
    const version = this.queries.fileVersion(uri);
    const cached = this.symbolCache.get(uri);
    if (cached && cached.version === version) {
      return cached.symbols;
    }
    const symbols = await this.queries.documentSymbols(uri);
    // An empty answer may mean "still starting", so it isn't kept.
    if (symbols.length > 0 && version > 0) {
      this.symbolCache.set(uri, { version, symbols });
    }
    return symbols;
  }

  /**
   * The chain of symbols around a position, cut at the innermost one that can
   * be a starting point (function, method, class, or a variable holding a function).
   */
  private async startChainAt(
    uri: string,
    symbols: DocSymbol[],
    pos: Pos,
  ): Promise<DocSymbol[] | undefined> {
    const chain = chainAt(symbols, pos) ?? [];
    for (let i = chain.length; i > 0; i--) {
      const inner = chain.slice(0, i);
      const symbol = inner[inner.length - 1];
      if (symbol && (await this.canStart(uri, symbol))) {
        return inner;
      }
    }
    return undefined;
  }

  private async canStart(uri: string, symbol: DocSymbol): Promise<boolean> {
    if (isAnonymousCallback(symbol.name)) {
      return false;
    }
    if (toNodeKind(symbol.kind)) {
      return true;
    }
    return isValueKind(symbol.kind) && (await this.holdsFunction(uri, symbol));
  }

  private async holdsFunction(uri: string, symbol: DocSymbol): Promise<boolean> {
    const end = symbol.selectionRange.end;
    const line = await this.queries.lineText(uri, end.line);
    return looksLikeFunctionValue(line.slice(end.character));
  }

  /** Turns a call hierarchy item into a card, using its file's symbols for a consistent kind and id. */
  private async resolveItem(item: CallItem): Promise<Resolved | undefined> {
    const external = this.queries.workspacePath(item.uri) === undefined;
    if (external && !this.options.showExternalCode) {
      // Not shown, so not worth reading the library file.
      return {
        node: this.bareNode(item, true),
        location: { uri: item.uri, pos: item.selectionRange.start, item },
      };
    }
    const symbols = await this.symbolsOf(item.uri);
    const chain = chainAt(symbols, item.selectionRange.start);
    if (!chain) {
      return {
        node: this.bareNode(item, external),
        location: { uri: item.uri, pos: item.selectionRange.start, item },
      };
    }
    const innermost = chain[chain.length - 1];
    if (innermost && !containsPos(innermost.selectionRange, item.selectionRange.start)) {
      // The target is a member the file's symbols don't list (for example a
      // method declared in a type alias). Name the card after the target, not
      // after the type around it, and keep that type as its parent.
      const node = this.bareNode(item, external);
      node.signature = oneLine(
        await this.queries.lineText(item.uri, item.selectionRange.start.line),
      );
      if (node.kind === 'function') {
        node.kind = 'method';
      }
      const owner = chain.filter((s) => toNodeKind(s.kind) !== undefined || s === innermost);
      node.parentId = makeId(
        item.uri,
        toNodeKind(innermost.kind) ?? 'interface',
        owner.map((s) => s.name).join('.'),
        innermost.selectionRange.start,
      );
      node.id = makeId(
        item.uri,
        node.kind,
        `${owner.map((s) => s.name).join('.')}.${item.name}`,
        item.selectionRange.start,
      );
      return { node, location: { uri: item.uri, pos: item.selectionRange.start, item } };
    }
    const resolved = await this.resolveChain(item.uri, chain);
    resolved.location.item = item;
    return resolved;
  }

  /** A card built from the call item alone, when its file's symbols are unknown. */
  private bareNode(item: CallItem, external: boolean): FlowNode {
    const kind = toNodeKind(item.kind) ?? 'function';
    const pos = item.selectionRange.start;
    return newNode({
      id: makeId(item.uri, kind, item.name, pos),
      name: item.name,
      kind,
      filePath: this.queries.workspacePath(item.uri) ?? item.uri,
      line: pos.line + 1,
      isExternal: external,
    });
  }

  /** Builds a card from the innermost symbol of a chain; outer symbols give the qualified name and parent. */
  private async resolveChain(uri: string, chain: DocSymbol[]): Promise<Resolved> {
    const symbol = chain[chain.length - 1];
    if (!symbol) {
      throw new Error('resolveChain needs at least one symbol');
    }
    const parents = chain.slice(0, -1);
    const parentClass = [...parents].reverse().find((s) => {
      const k = toNodeKind(s.kind);
      return k !== undefined && isClassLike(k);
    });
    const kind = normaliseKind(symbol, parentClass !== undefined);
    const qualified = chain
      .filter((s) => toNodeKind(s.kind) !== undefined || s === symbol)
      .map((s) => s.name)
      .join('.');
    const pos = symbol.selectionRange.start;
    const filePath = this.queries.workspacePath(uri);
    const id = makeId(uri, kind, qualified, pos);

    const node = newNode({
      id,
      name: symbol.name,
      kind,
      filePath: filePath ?? uri,
      line: pos.line + 1,
      signature: oneLine(await this.queries.lineText(uri, pos.line)),
      isExternal: filePath === undefined,
    });

    if ((kind === 'method' || kind === 'constructor') && parentClass) {
      const parentChain = chain.slice(0, chain.indexOf(parentClass) + 1);
      node.parentId = makeId(
        uri,
        normaliseKind(parentClass, false),
        parentChain
          .filter((s) => toNodeKind(s.kind) !== undefined)
          .map((s) => s.name)
          .join('.'),
        parentClass.selectionRange.start,
      );
    }
    if (isClassLike(kind)) {
      await this.addMembers(uri, node, symbol, qualified);
    }
    return { node, location: { uri, pos } };
  }

  /** Fills a class card's rows and remembers where each member is, so it can be expanded later. */
  private async addMembers(
    uri: string,
    node: FlowNode,
    symbol: DocSymbol,
    qualified: string,
  ): Promise<void> {
    const rows: MemberRow[] = [];
    for (const child of symbol.children) {
      let kind = memberKind(child);
      // A property holding an arrow function is a method in all but syntax.
      if (kind === 'field' && isValueKind(child.kind) && (await this.holdsFunction(uri, child))) {
        kind = 'method';
      }
      if (!kind || isAnonymousCallback(child.name)) {
        continue;
      }
      const pos = child.selectionRange.start;
      const id =
        kind === 'field'
          ? `${uri}#field:${qualified}.${child.name}@${pos.line}:${pos.character}`
          : makeId(uri, kind, `${qualified}.${child.name}`, pos);
      rows.push({ id, name: child.name, kind, line: pos.line + 1 });
      if (kind !== 'field' && !this.locations.has(id)) {
        this.locations.set(id, { uri, pos });
      }
    }
    rows.sort((a, b) => a.line - b.line);
    node.members = rows.slice(0, MAX_MEMBER_ROWS);
    node.hiddenMembers = Math.max(0, rows.length - MAX_MEMBER_ROWS);
  }
}

// ---- pure helpers --------------------------------------------------------

/** `<file URI>#<kind>:<qualified name>@<line>:<column>` (0-based), as in docs/DATA_MODEL.md. */
export function makeId(uri: string, kind: NodeKind, qualifiedName: string, pos: Pos): string {
  return `${uri}#${kind}:${qualifiedName}@${pos.line}:${pos.character}`;
}

/**
 * Language servers don't always agree on kind (Pylance called the same method
 * "Method" and "Function" in Phase 1). A function directly inside a class is a
 * method; a variable holding a function is a function.
 */
function normaliseKind(symbol: DocSymbol, insideClass: boolean): NodeKind {
  const kind = toNodeKind(symbol.kind) ?? 'function';
  if (kind === 'function' && insideClass) {
    return symbol.name === '__init__' ? 'constructor' : 'method';
  }
  if (kind === 'method' && symbol.name === '__init__') {
    return 'constructor';
  }
  return kind;
}

function memberKind(symbol: DocSymbol): MemberRow['kind'] | undefined {
  switch (symbol.kind) {
    case 'Method':
    case 'Function':
      return symbol.name === '__init__' ? 'constructor' : 'method';
    case 'Constructor':
      return 'constructor';
    case 'Field':
    case 'Property':
    case 'Variable':
    case 'Constant':
      return 'field';
    default:
      return undefined;
  }
}

function newNode(
  fields: Partial<FlowNode> & Pick<FlowNode, 'id' | 'name' | 'kind' | 'filePath' | 'line'>,
): FlowNode {
  return {
    signature: '',
    docComment: '',
    isExternal: false,
    isRecursive: false,
    isStale: false,
    expanded: [],
    ...fields,
  };
}

/** The innermost-last chain of symbols whose range contains the position. */
export function chainAt(symbols: DocSymbol[], pos: Pos): DocSymbol[] | undefined {
  const chain: DocSymbol[] = [];
  let level = symbols;
  for (;;) {
    // Prefer a symbol whose name is at the position (call items point at names).
    const next =
      level.find((s) => containsPos(s.selectionRange, pos)) ??
      level.find((s) => containsPos(s.range, pos));
    if (!next) {
      break;
    }
    chain.push(next);
    if (containsPos(next.selectionRange, pos)) {
      break;
    }
    level = next.children;
  }
  return chain.length > 0 ? chain : undefined;
}

export function containsPos(span: Span, pos: Pos): boolean {
  return comparePos(span.start, pos) <= 0 && comparePos(pos, span.end) <= 0;
}

export function comparePos(a: Pos, b: Pos): number {
  return a.line - b.line || a.character - b.character;
}

/** Removes repeated spans (same start), keeping source order. */
export function uniqueSpans(spans: Span[]): Span[] {
  const seen = new Set<string>();
  return spans
    .filter((span) => {
      const key = `${span.start.line}:${span.start.character}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => comparePos(a.start, b.start));
}

function oneLine(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > MAX_SIGNATURE ? `${trimmed.slice(0, MAX_SIGNATURE - 1)}â€¦` : trimmed;
}
