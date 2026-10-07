// Messages between the extension host and the panel (docs/DATA_MODEL.md,
// section 2). Both sides check every message against these schemas, so a
// malformed or unexpected message is dropped instead of acted on.
import { z } from 'zod';
import type { FlowGraph, GraphPatch } from './types';

const nodeKind = z.enum([
  'function',
  'method',
  'constructor',
  'class',
  'interface',
  'struct',
  'enum',
]);
const relation = z.enum(['calls', 'calledBy', 'contains', 'usedBy', 'extends']);
const edgeKind = z.enum(['calls', 'calledBy', 'contains', 'usedBy', 'extends', 'implements']);
const id = z.string().min(1).max(4000);

const memberRow = z.object({
  id,
  name: z.string(),
  kind: z.union([nodeKind, z.literal('field')]),
  line: z.number().int(),
});

const flowNode = z.object({
  id,
  name: z.string(),
  kind: nodeKind,
  filePath: z.string(),
  line: z.number().int(),
  signature: z.string(),
  docComment: z.string(),
  parentId: id.optional(),
  members: z.array(memberRow).optional(),
  hiddenMembers: z.number().int().optional(),
  isExternal: z.boolean(),
  isRecursive: z.boolean(),
  isStale: z.boolean(),
  expanded: z.array(relation),
  more: z.partialRecord(relation, z.number().int()).optional(),
  explanation: z.string().optional(),
});

const flowEdge = z.object({
  id,
  fromId: id,
  toId: id,
  kind: edgeKind,
  order: z.number().int(),
  callLines: z.array(z.number().int()),
});

const flowGraph = z.object({
  rootId: id,
  nodes: z.array(flowNode),
  edges: z.array(flowEdge),
  hiddenCount: z.number().int(),
  truncated: z.boolean(),
});

const graphPatch = z.object({
  addNodes: z.array(flowNode),
  addEdges: z.array(flowEdge),
  updateNodes: z.array(flowNode),
  removeIds: z.array(id),
  hiddenCount: z.number().int(),
});

const graphStatus = z.enum([
  'ok',
  'empty',
  'languageServerStarting',
  'unsupported',
  'noSymbol',
  'error',
]);

// ---- panel → host --------------------------------------------------------

export const toHost = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  /** `all`: also load what a "+N more" card left out. */
  z.object({ type: z.literal('expand'), nodeId: id, relation, all: z.boolean().optional() }),
  z.object({ type: z.literal('collapse'), nodeId: id, relation }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('forward') }),
  /** The user closed the first-open hint; it is not shown again. */
  z.object({ type: z.literal('dismissHint') }),
  z.object({ type: z.literal('reveal'), nodeId: id }),
  /** Run the last "Show flow" again (after "language server starting"). */
  z.object({ type: z.literal('retry') }),
]);
export type ToHost = z.infer<typeof toHost>;

// ---- host → panel --------------------------------------------------------

export const toPanel = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('graph:init'),
    status: graphStatus,
    message: z.string().optional(),
    graph: flowGraph.optional(),
    /** Show the one-time "how to explore" hint. */
    showHint: z.boolean().optional(),
    /** Earlier or later starting points exist (Back / Forward). */
    canGoBack: z.boolean().optional(),
    canGoForward: z.boolean().optional(),
  }),
  z.object({ type: z.literal('graph:patch'), patch: graphPatch }),
  /** A card finished (or failed) loading; `error` is shown next to the graph. */
  z.object({
    type: z.literal('expand:done'),
    nodeId: id,
    relation,
    error: z.string().optional(),
  }),
]);
export type ToPanel = z.infer<typeof toPanel>;

// Compile-time checks that the schemas and the shared types stay in step.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const graphMatches: Same<z.infer<typeof flowGraph>, FlowGraph> = true;
const patchMatches: Same<z.infer<typeof graphPatch>, GraphPatch> = true;
void graphMatches;
void patchMatches;
