// The graph shared by the extension host and the panel (docs/DATA_MODEL.md).
// Plain data only: no VS Code types, so the panel and unit tests can use it.

export type NodeKind =
  'function' | 'method' | 'constructor' | 'class' | 'interface' | 'struct' | 'enum';

export type EdgeKind = 'calls' | 'calledBy' | 'contains' | 'usedBy' | 'extends' | 'implements';

export type Relation = 'calls' | 'calledBy' | 'contains' | 'usedBy' | 'extends';

/** A row on a class card: a method or constructor (which can become a card), or a field. */
export interface MemberRow {
  id: string;
  name: string;
  kind: NodeKind | 'field';
  /** 1-based. */
  line: number;
}

export interface FlowNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** Workspace-relative, for display. */
  filePath: string;
  /** 1-based. */
  line: number;
  signature: string;
  docComment: string;
  /** For a method or constructor: the id of its class-like parent. */
  parentId?: string;
  /** Only on class-like cards. */
  members?: MemberRow[];
  /** Rows not listed because of the member cap. */
  hiddenMembers?: number;
  isExternal: boolean;
  isRecursive: boolean;
  isStale: boolean;
  expanded: Relation[];
  explanation?: string;
}

export interface FlowEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: EdgeKind;
  /** Arrow number in the caller's text order; 0 when unknown (found through "called by"). */
  order: number;
  /** 1-based lines in the caller where the call happens. */
  callLines: number[];
}

export interface FlowGraph {
  rootId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  hiddenCount: number;
  truncated: boolean;
}

/** Why a graph could not be built, or why it is empty. */
export type GraphStatus = 'ok' | 'empty' | 'languageServerStarting' | 'unsupported' | 'noSymbol';

export interface GraphPatch {
  addNodes: FlowNode[];
  addEdges: FlowEdge[];
  /** Existing nodes whose fields changed (for example `expanded` or `isRecursive`). */
  updateNodes: FlowNode[];
  removeIds: string[];
  hiddenCount: number;
}

export const CLASS_LIKE: readonly NodeKind[] = ['class', 'interface', 'struct', 'enum'];
