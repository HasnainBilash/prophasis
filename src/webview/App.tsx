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
import { ActionsContext, kindInfo, useActions, type CardActions } from './actions';
import { CallEdge, type CallEdgeType } from './CallEdge';
import { Card, type CardNode } from './Card';
import { MoreCard, type MoreNode } from './MoreCard';
import { listen, send } from './host';
import { callPath, layoutGraph, pathThrough } from './layout';
import { initialState, pendingKey, reduce, type PanelState } from './state';

const nodeTypes = { card: Card, more: MoreCard };
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
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  useEffect(() => {
    const stop = listen((message) => dispatch({ type: 'message', message }));
    send({ type: 'ready' });
    return stop;
  }, []);

  const actions = useMemo<CardActions>(
    () => ({
      expand(nodeId: string, relation: Relation, all?: boolean) {
        dispatch({ type: 'expandStarted', nodeId, relation });
        send({ type: 'expand', nodeId, relation, all });
      },
      collapse(nodeId: string, relation: Relation) {
        send({ type: 'collapse', nodeId, relation });
      },
      reveal(nodeId: string) {
        send({ type: 'reveal', nodeId });
      },
      explain(nodeId: string, path?: boolean) {
        const name = state.nodes.get(nodeId)?.name ?? '';
        const ids =
          path && state.rootId
            ? callPath(state.rootId, nodeId, [...state.edges.values()])
            : undefined;
        if (path && !ids) {
          return;
        }
        dispatch({ type: 'explainStarted', title: path ? `Path to ${name}` : `Explain ${name}` });
        send({ type: 'explain', nodeId, pathNodeIds: ids });
      },
      isPending: (nodeId, relation) => state.pending.has(pendingKey(nodeId, relation)),
      nodeById: (nodeId) => state.nodes.get(nodeId),
    }),
    [state.pending, state.nodes, state.edges, state.rootId],
  );

  const layout = useMemo(() => layoutGraph(state.nodes, [...state.edges.values()]), [state]);
  const onPath = useMemo(
    () => (hovered ? pathThrough(hovered, layout.arrows) : null),
    [hovered, layout],
  );
  const matches = useMemo(() => searchCards(query, layout.cards), [query, layout]);
  // Hovering shows one card's flow; otherwise a search dims what doesn't match.
  const lit = onPath ?? matches;
  const { nodes, edges } = useMemo(() => toFlow(state, layout, lit), [state, layout, lit]);

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
          onNodeContextMenu={(event, node) => {
            if (node.type === 'card') {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
            }
          }}
          onPaneClick={() => setMenu(null)}
          onMoveStart={() => setMenu(null)}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} className="dots" />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            ariaLabel="Overview of the whole graph"
            nodeClassName={(node: Node) =>
              node.type === 'more' ? 'mini-more' : `mini-${(node as CardNode).data.node.kind}`
            }
            nodeBorderRadius={6}
            className="minimap"
            style={{ width: 132, height: 88 }}
          />
          <FitOnChange state={state} />

          <Panel position="top-left" className="toolbar">
            <button
              type="button"
              className="icon-btn"
              disabled={!state.canGoBack}
              title="Back to the previous starting point"
              aria-label="Back"
              onClick={() => send({ type: 'back' })}
            >
              ←
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={!state.canGoForward}
              title="Forward to the next starting point"
              aria-label="Forward"
              onClick={() => send({ type: 'forward' })}
            >
              →
            </button>
            <span className="brand">Prophasis</span>
            {state.rootId && (
              <span className="start-name" title="The starting point">
                {state.nodes.get(state.rootId)?.name}
              </span>
            )}
            <SearchBox query={query} onChange={setQuery} matches={matches} />
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
          {state.explanation && (
            <Panel position="top-right" className="drawer" role="region" aria-label="Explanation">
              <ExplanationView
                explanation={state.explanation}
                onClose={() => {
                  dispatch({ type: 'closeExplanation' });
                  send({ type: 'cancelExplain' });
                }}
              />
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
        {menu && (
          <CardMenu
            {...menu}
            canExplainPath={
              menu.nodeId !== state.rootId &&
              state.rootId !== undefined &&
              callPath(state.rootId, menu.nodeId, [...state.edges.values()]) !== undefined
            }
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </ActionsContext.Provider>
  );
}

/** Cards whose name, or one of whose member names, contains the search text; null when not searching. */
function searchCards(query: string, cards: ReturnType<typeof layoutGraph>['cards']) {
  const text = query.trim().toLowerCase();
  if (!text) {
    return null;
  }
  return new Set(
    cards
      .filter((card) =>
        [card.node?.name, ...(card.node?.members ?? []).map((m) => m.name)].some((name) =>
          name?.toLowerCase().includes(text),
        ),
      )
      .map((card) => card.id),
  );
}

/** Builds React Flow's nodes and edges from the layout, dimming what isn't lit. */
function toFlow(
  state: PanelState,
  layout: ReturnType<typeof layoutGraph>,
  lit: Set<string> | null,
): { nodes: (CardNode | MoreNode)[]; edges: CallEdgeType[] } {
  const nodes: (CardNode | MoreNode)[] = [];
  for (const card of layout.cards) {
    const base = {
      id: card.id,
      position: { x: card.x, y: card.y },
      width: card.width,
      height: card.height,
    };
    if (card.more) {
      nodes.push({ ...base, type: 'more', data: { more: card.more } });
    } else if (card.node) {
      nodes.push({
        ...base,
        type: 'card',
        data: {
          node: card.node,
          isRoot: card.id === state.rootId,
          dimmed: lit !== null && !lit.has(card.id),
        },
      });
    }
  }
  const edges = layout.arrows.map((arrow): CallEdgeType => ({
    id: arrow.edge.id,
    type: 'call',
    source: arrow.source,
    sourceHandle: arrow.sourceHandle,
    target: arrow.target,
    targetHandle: arrow.targetHandle,
    className: [
      `kind-${arrow.edge.kind}`,
      arrow.toMore ? 'to-more' : '',
      lit === null ? '' : lit.has(arrow.source) && lit.has(arrow.target) ? 'lit' : 'dimmed',
    ].join(' '),
    data: { arrow },
    // Calls get a filled arrowhead; uses and type relations an open one; "+N more" none.
    markerEnd: arrow.toMore
      ? undefined
      : {
          type:
            arrow.edge.kind === 'calls' || arrow.edge.kind === 'calledBy'
              ? MarkerType.ArrowClosed
              : MarkerType.Arrow,
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

/** Search box: dims cards that don't match; Enter brings the matches into view. */
function SearchBox(props: {
  query: string;
  onChange: (query: string) => void;
  matches: Set<string> | null;
}) {
  const flow = useReactFlow();
  const count = props.matches?.size ?? 0;
  return (
    <span className="search">
      <input
        type="search"
        value={props.query}
        placeholder="Search cards"
        aria-label="Search cards by name"
        title="Type a name to highlight matching cards; press Enter to bring them into view"
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && count > 0) {
            void flow.fitView({
              nodes: [...(props.matches ?? [])].map((id) => ({ id })),
              padding: 0.3,
              maxZoom: 1,
              duration: 200,
            });
          }
          if (event.key === 'Escape') {
            props.onChange('');
          }
        }}
      />
      {props.matches && <span className="search-count">{count}</span>}
    </span>
  );
}

/** Right-click menu on a card. */
function CardMenu(props: {
  x: number;
  y: number;
  nodeId: string;
  canExplainPath: boolean;
  onClose: () => void;
}) {
  const actions = useActions();
  const item = (label: string, run: () => void, disabled = false, tip?: string) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={tip}
      onClick={() => {
        run();
        props.onClose();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      className="card-menu"
      role="menu"
      style={{ left: props.x, top: props.y }}
      onKeyDown={(event) => event.key === 'Escape' && props.onClose()}
    >
      {item('Open code', () => actions.reveal(props.nodeId))}
      {item('Explain this', () => actions.explain(props.nodeId))}
      {item(
        'Explain path from start to here',
        () => actions.explain(props.nodeId, true),
        !props.canExplainPath,
        props.canExplainPath
          ? 'Explains how the calls lead from the start card to this one'
          : 'Only for cards joined to the start card by calls',
      )}
    </div>
  );
}

/** The explanation drawer. Generated text is shown as plain text, never as HTML. */
function ExplanationView(props: {
  explanation: NonNullable<PanelState['explanation']>;
  onClose: () => void;
}) {
  const { title, loading, text, error, model, truncated, cached } = props.explanation;
  return (
    <div className="explanation">
      <div className="legend-head">
        <b>{title}</b>
        <button type="button" className="icon-btn" onClick={props.onClose} title="Close">
          ×
        </button>
      </div>
      {loading && (
        <p className="muted">
          <span className="spinner" aria-hidden="true" /> Asking the language model…
        </p>
      )}
      {error && <p className="explain-error">{error}</p>}
      {text && <div className="explain-text">{text}</div>}
      {text && (
        <p className="muted small">
          Generated by {model ?? 'a language model'}
          {cached ? ' (from this session)' : ''}, based only on the code that was sent
          {truncated ? ', which was cut to fit' : ''}. It can be wrong.
        </p>
      )}
    </div>
  );
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
        A dashed arrow is a <b>use</b> (the code refers to it without calling it here) or a type
        relation, labelled <b>extends</b> or <b>implements</b>.
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
