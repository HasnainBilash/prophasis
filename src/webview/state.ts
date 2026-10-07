import type { ToPanel } from '../shared/messages';
import type { FlowEdge, FlowNode, Relation } from '../shared/types';

export interface PanelState {
  status: Extract<ToPanel, { type: 'graph:init' }>['status'] | 'loading';
  message?: string;
  rootId?: string;
  nodes: Map<string, FlowNode>;
  edges: Map<string, FlowEdge>;
  hiddenCount: number;
  /** Expansions waiting for an answer, as `nodeId|relation`. */
  pending: Set<string>;
  /** The latest expansion error, shown as a dismissible note. */
  error?: string;
  /** Ids added by the latest change, so the view can bring them into sight. */
  focusIds: string[];
  /** Increases on every graph change; the view re-fits when it changes. */
  revision: number;
  /** The one-time "how to explore" hint is showing. */
  showHint: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The explanation drawer: waiting for an answer, or showing one. */
  explanation?: {
    title: string;
    loading: boolean;
    text?: string;
    error?: string;
    model?: string;
    truncated?: boolean;
    cached?: boolean;
  };
}

export type Action =
  | { type: 'message'; message: ToPanel }
  | { type: 'expandStarted'; nodeId: string; relation: Relation }
  | { type: 'dismissError' }
  | { type: 'dismissHint' }
  | { type: 'explainStarted'; title: string }
  | { type: 'closeExplanation' };

export const initialState: PanelState = {
  status: 'loading',
  nodes: new Map(),
  edges: new Map(),
  hiddenCount: 0,
  pending: new Set(),
  focusIds: [],
  revision: 0,
  showHint: false,
  canGoBack: false,
  canGoForward: false,
};

export const pendingKey = (nodeId: string, relation: Relation) => `${nodeId}|${relation}`;

export function reduce(state: PanelState, action: Action): PanelState {
  switch (action.type) {
    case 'expandStarted': {
      const pending = new Set(state.pending);
      pending.add(pendingKey(action.nodeId, action.relation));
      return { ...state, pending, error: undefined };
    }
    case 'dismissError':
      return { ...state, error: undefined };
    case 'dismissHint':
      return { ...state, showHint: false };
    case 'explainStarted':
      return { ...state, explanation: { title: action.title, loading: true } };
    case 'closeExplanation':
      return { ...state, explanation: undefined };
    case 'message':
      return applyMessage(state, action.message);
  }
}

function applyMessage(state: PanelState, message: ToPanel): PanelState {
  switch (message.type) {
    case 'graph:init': {
      const graph = message.graph;
      return {
        ...initialState,
        status: message.status,
        message: message.message,
        rootId: graph?.rootId,
        nodes: new Map(graph?.nodes.map((n) => [n.id, n])),
        edges: new Map(graph?.edges.map((e) => [e.id, e])),
        hiddenCount: graph?.hiddenCount ?? 0,
        // If the whole graph can't be shown readably, start from the start card.
        focusIds: graph ? [graph.rootId] : [],
        revision: state.revision + 1,
        showHint: message.showHint ?? false,
        canGoBack: message.canGoBack ?? false,
        canGoForward: message.canGoForward ?? false,
      };
    }
    case 'graph:patch': {
      const { patch } = message;
      const nodes = new Map(state.nodes);
      const edges = new Map(state.edges);
      for (const id of patch.removeIds) {
        nodes.delete(id);
        edges.delete(id);
      }
      for (const node of [...patch.addNodes, ...patch.updateNodes]) {
        nodes.set(node.id, node);
      }
      // An edge with an existing id replaces it (a "called by" arrow that got its number).
      for (const edge of patch.addEdges) {
        edges.set(edge.id, edge);
      }
      const focusIds = [...patch.addNodes.map((n) => n.id), ...patch.updateNodes.map((n) => n.id)];
      // An empty status ("no calls found") no longer applies once something was added.
      const status = state.status === 'empty' && patch.addEdges.length > 0 ? 'ok' : state.status;
      return {
        ...state,
        status,
        nodes,
        edges,
        hiddenCount: patch.hiddenCount,
        focusIds,
        revision: state.revision + 1,
      };
    }
    case 'explain:result': {
      // Closing the drawer cancels the request, so any answer that arrives is wanted.
      return {
        ...state,
        explanation: {
          title: message.title,
          loading: false,
          text: message.text,
          error: message.error,
          model: message.model,
          truncated: message.truncated,
          cached: message.cached,
        },
      };
    }
    case 'expand:done': {
      const pending = new Set(state.pending);
      pending.delete(pendingKey(message.nodeId, message.relation));
      return { ...state, pending, error: message.error };
    }
  }
}
