import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Node,
} from '@xyflow/react';
import { useEffect, useMemo, useReducer, useState } from 'react';
import type { Relation } from '../shared/types';
import { ActionsContext, kindInfo, type CardActions } from './actions';
import { CallEdge, type CallEdgeType } from './CallEdge';
import { Card, type CardNode } from './Card';
import { listen, send } from './host';
import { layoutGraph, pathThrough } from './layout';
import { initialState, pendingKey, reduce, type PanelState } from './state';

const nodeTypes = { card: Card };
const edgeTypes = { call: CallEdge };
/** Below this zoom, card text gets too small to read. */
const READABLE_ZOOM = 0.75;
const shallowSize = (a: { width: number; height: number }, b: { width: number; height: number }) =>
  a.width === b.width && a.height === b.height;

export function App() {
  return (
    <ReactFlowProvider>
      <Graph />
    </ReactFlowProvider>
  );
}

function Graph() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [hovered, setHovered] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  useEffect(() => {
    const stop = listen((message) => dispatch({ type: 'message', message }));
    send({ type: 'ready' });
    return stop;
  }, []);

  const actions = useMemo<CardActions>(
    () => ({
      expand(nodeId: string, relation: Relation) {
        dispatch({ type: 'expandStarted', nodeId, relation });
        send({ type: 'expand', nodeId, relation });
      },
      collapse(nodeId: string, relation: Relation) {
        send({ type: 'collapse', nodeId, relation });
      },
      reveal(nodeId: string) {
        send({ type: 'reveal', nodeId });
      },
      isPending: (nodeId, relation) => state.pending.has(pendingKey(nodeId, relation)),
      nodeById: (nodeId) => state.nodes.get(nodeId),
    }),
    [state.pending, state.nodes],
  );

  const layout = useMemo(() => layoutGraph(state.nodes, [...state.edges.values()]), [state]);
  const onPath = useMemo(
    () => (hovered ? pathThrough(hovered, layout.arrows) : null),
    [hovered, layout],
  );
  const { nodes, edges } = useMemo(() => toFlow(state, layout, onPath), [state, layout, onPath]);

  const dismissHint = () => {
    dispatch({ type: 'dismissHint' });
    send({ type: 'dismissHint' });
  };

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnScroll
          minZoom={0.2}
          maxZoom={2}
          onNodeMouseEnter={(_, node) => setHovered(node.id)}
          onNodeMouseLeave={() => setHovered(null)}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} className="dots" />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            ariaLabel="Overview of the whole graph"
            nodeClassName={(node: Node) => `mini-${(node as CardNode).data.node.kind}`}
            nodeBorderRadius={6}
            className="minimap"
            style={{ width: 132, height: 88 }}
          />
          <FitOnChange state={state} />

          <Panel position="top-left" className="toolbar">
            <span className="brand">Prophasis</span>
            {state.rootId && (
              <span className="start-name" title="The starting point">
                {state.nodes.get(state.rootId)?.name}
              </span>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-expanded={legendOpen}
              title="How to read this graph"
              onClick={() => setLegendOpen((open) => !open)}
            >
              ?
            </button>
          </Panel>
          {legendOpen && (
            <Panel position="top-left" className="legend-wrap">
              <Legend onClose={() => setLegendOpen(false)} />
            </Panel>
          )}

          <Panel position="top-center">
            <StatusBanner state={state} />
          </Panel>

          {state.showHint && state.status !== 'loading' && (
            <Panel position="bottom-center" className="hint" role="note">
              <span>
                <b>Tip:</b> click <b>Calls →</b> or <b>← Called by</b> on any card to explore. Click
                a card to open its code. Click a lit button again to hide what it showed.
              </span>
              <button type="button" className="chip" onClick={dismissHint}>
                Got it
              </button>
            </Panel>
          )}
          {state.hiddenCount > 0 && (
            <Panel position="top-right" className="pill">
              {state.hiddenCount} more not shown (card limit)
            </Panel>
          )}
          {state.error && (
            <Panel position="bottom-center" className="toast" role="alert">
              <span>{state.error}</span>
              <button type="button" onClick={() => dispatch({ type: 'dismissError' })}>
                Dismiss
              </button>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </ActionsContext.Provider>
  );
}

/** Builds React Flow's nodes and edges from the layout, dimming what is off the hovered path. */
function toFlow(
  state: PanelState,
  layout: ReturnType<typeof layoutGraph>,
  onPath: Set<string> | null,
): { nodes: CardNode[]; edges: CallEdgeType[] } {
  const nodes = layout.cards.map((card): CardNode => ({
    id: card.id,
    type: 'card',
    position: { x: card.x, y: card.y },
    width: card.width,
    height: card.height,
    data: {
      node: card.node,
      isRoot: card.id === state.rootId,
      dimmed: onPath !== null && !onPath.has(card.id),
    },
  }));
  const edges = layout.arrows.map((arrow): CallEdgeType => ({
    id: arrow.edge.id,
    type: 'call',
    source: arrow.source,
    sourceHandle: arrow.sourceHandle,
    target: arrow.target,
    targetHandle: arrow.targetHandle,
    className:
      onPath === null
        ? ''
        : onPath.has(arrow.source) && onPath.has(arrow.target)
          ? 'lit'
          : 'dimmed',
    data: { arrow },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: `var(--k-${arrow.callerKind})`,
    },
  }));
  return { nodes, edges };
}

/** After each change, brings the new cards into view (the whole graph if it stays readable). */
function FitOnChange({ state }: { state: PanelState }) {
  const flow = useReactFlow();
  const size = useStore((s) => ({ width: s.width, height: s.height }), shallowSize);
  useEffect(() => {
    if (state.revision === 0) {
      return;
    }
    // Wait a frame so React Flow has the new nodes before fitting.
    const frame = requestAnimationFrame(() => {
      const all = flow.getNodes();
      if (all.length === 0) {
        return;
      }
      const visible = new Set(all.map((n) => n.id));
      const focus = state.focusIds.filter((id) => visible.has(id)).map((id) => ({ id }));
      // Show the whole graph if its text stays readable; otherwise show what
      // just changed. The fit button in the corner always shows everything.
      const bounds = flow.getNodesBounds(all);
      const fitsReadable =
        Math.min(size.width / (bounds.width * 1.2), size.height / (bounds.height * 1.2)) >=
        READABLE_ZOOM;
      void flow.fitView({
        nodes: fitsReadable || focus.length === 0 ? undefined : focus,
        padding: 0.15,
        minZoom: READABLE_ZOOM,
        maxZoom: 1,
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200,
      });
    });
    return () => cancelAnimationFrame(frame);
    // Only a new revision should move the view, not every render.
  }, [state.revision]);
  return null;
}

function Legend({ onClose }: { onClose: () => void }) {
  const kinds = ['function', 'method', 'constructor', 'class', 'interface'] as const;
  return (
    <div className="legend" role="dialog" aria-label="How to read this graph">
      <div className="legend-head">
        <b>How to read this graph</b>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <ul>
        {kinds.map((kind) => (
          <li key={kind} className={`kind-${kind}`}>
            <span className="glyph small" aria-hidden="true">
              {kindInfo[kind].glyph}
            </span>
            {kindInfo[kind].label}
          </li>
        ))}
      </ul>
      <p>
        <span className="badge inline from-method">1</span> Arrows are numbered in the order the
        calls are written in the code. A call inside an <code>if</code> may never run.
      </p>
      <p>
        An arrow without a number came from <b>← Called by</b>: the caller’s other calls aren’t
        loaded.
      </p>
      <p>
        <b>↻ recursive</b>: the function calls itself, directly or through others.
      </p>
      <p>
        Hover a card to light up its flow. Click a card to open its code. Library code is hidden
        unless <code>prophasis.showExternalCode</code> is on.
      </p>
    </div>
  );
}

const statusText = {
  empty:
    'No calls found. This function may only use library code (hidden by default), or call things the language server can’t see, such as callbacks.',
  unsupported:
    'This language’s extension doesn’t provide call information. Prophasis is tested with TypeScript, JavaScript and Python.',
  languageServerStarting: 'The language server is still starting. Try again in a few seconds.',
  noSymbol: 'No function, method or class found here.',
} as const;

function StatusBanner({ state }: { state: PanelState }) {
  if (state.status === 'ok') {
    return null;
  }
  if (state.status === 'loading') {
    return <div className="banner">Loading…</div>;
  }
  const text =
    state.status === 'error'
      ? (state.message ?? 'Something went wrong.')
      : statusText[state.status];
  const canRetry = state.status === 'languageServerStarting' || state.status === 'error';
  return (
    <div className={`banner ${state.status}`} role="status">
      <span>{text}</span>
      {canRetry && (
        <button type="button" className="chip" onClick={() => send({ type: 'retry' })}>
          Retry
        </button>
      )}
    </div>
  );
}
