import { describe, expect, it } from 'vitest';
import { toHost, toPanel } from '../../src/shared/messages';
import type { FlowEdge, FlowGraph, FlowNode } from '../../src/shared/types';
import { initialState, reduce, type PanelState } from '../../src/webview/state';

const node = (id: string, fields: Partial<FlowNode> = {}): FlowNode => ({
  id,
  name: id,
  kind: 'function',
  filePath: 'a.ts',
  line: 1,
  signature: '',
  docComment: '',
  isExternal: false,
  isRecursive: false,
  isStale: false,
  expanded: [],
  ...fields,
});
const edge = (fromId: string, toId: string, fields: Partial<FlowEdge> = {}): FlowEdge => ({
  id: `${fromId}->${toId}`,
  fromId,
  toId,
  kind: 'calls',
  order: 1,
  callLines: [3],
  ...fields,
});
const graph = (nodes: FlowNode[], edges: FlowEdge[] = []): FlowGraph => ({
  rootId: nodes[0]?.id ?? '',
  nodes,
  edges,
  hiddenCount: 0,
  truncated: false,
});

const init = (g: FlowGraph, status: 'ok' | 'empty' = 'ok'): PanelState =>
  reduce(initialState, {
    type: 'message',
    message: { type: 'graph:init', status, graph: g, showHint: true },
  });

describe('panel state', () => {
  it('starts from a full graph and focuses the start card', () => {
    const state = init(graph([node('root'), node('a')], [edge('root', 'a')]));
    expect(state.rootId).toBe('root');
    expect([...state.nodes.keys()]).toEqual(['root', 'a']);
    expect(state.focusIds).toEqual(['root']);
    expect(state.showHint).toBe(true);
    expect(state.revision).toBe(1);
  });

  it('applies a patch: adds, updates, replaces an edge with the same id, removes', () => {
    let state = init(
      graph(
        [node('root'), node('caller')],
        [edge('caller', 'root', { kind: 'calledBy', order: 0 })],
      ),
    );
    state = reduce(state, {
      type: 'message',
      message: {
        type: 'graph:patch',
        patch: {
          addNodes: [node('b')],
          updateNodes: [node('root', { expanded: ['calls'] })],
          addEdges: [edge('caller', 'root', { kind: 'calls', order: 2 }), edge('root', 'b')],
          removeIds: [],
          hiddenCount: 4,
        },
      },
    });
    expect(state.nodes.get('root')?.expanded).toEqual(['calls']);
    expect(state.edges.get('caller->root')).toMatchObject({ kind: 'calls', order: 2 });
    expect(state.hiddenCount).toBe(4);
    expect(state.focusIds).toEqual(['b', 'root']);

    state = reduce(state, {
      type: 'message',
      message: {
        type: 'graph:patch',
        patch: {
          addNodes: [],
          updateNodes: [],
          addEdges: [],
          removeIds: ['b', 'root->b'],
          hiddenCount: 4,
        },
      },
    });
    expect(state.nodes.has('b')).toBe(false);
    expect(state.edges.has('root->b')).toBe(false);
  });

  it('clears "no calls found" once something is added', () => {
    let state = init(graph([node('root')]), 'empty');
    state = reduce(state, {
      type: 'message',
      message: {
        type: 'graph:patch',
        patch: {
          addNodes: [node('x')],
          updateNodes: [],
          addEdges: [edge('x', 'root', { kind: 'calledBy', order: 0 })],
          removeIds: [],
          hiddenCount: 0,
        },
      },
    });
    expect(state.status).toBe('ok');
  });

  it('tracks a pending expansion until it is done, and shows its error', () => {
    let state = reduce(init(graph([node('root')])), {
      type: 'expandStarted',
      nodeId: 'root',
      relation: 'calls',
    });
    expect(state.pending.has('root|calls')).toBe(true);
    state = reduce(state, {
      type: 'message',
      message: { type: 'expand:done', nodeId: 'root', relation: 'calls', error: 'too slow' },
    });
    expect(state.pending.size).toBe(0);
    expect(state.error).toBe('too slow');
  });

  it('opens the explanation drawer, fills it, and closes it', () => {
    let state = reduce(init(graph([node('root')])), {
      type: 'explainStarted',
      title: 'Explain root',
    });
    expect(state.explanation).toEqual({ title: 'Explain root', loading: true });
    state = reduce(state, {
      type: 'message',
      message: {
        type: 'explain:result',
        nodeId: 'root',
        path: false,
        title: 'Explain root',
        text: 'It works.',
        model: 'M',
      },
    });
    expect(state.explanation).toMatchObject({ loading: false, text: 'It works.', model: 'M' });
    state = reduce(state, { type: 'closeExplanation' });
    expect(state.explanation).toBeUndefined();
  });
});

describe('message checks (both directions are validated)', () => {
  it('accepts well-formed messages', () => {
    expect(
      toHost.safeParse({ type: 'expand', nodeId: 'a', relation: 'calls', all: true }).success,
    ).toBe(true);
    expect(
      toHost.safeParse({ type: 'explain', nodeId: 'a', pathNodeIds: ['r', 'a'] }).success,
    ).toBe(true);
    expect(
      toPanel.safeParse({ type: 'graph:init', status: 'ok', graph: graph([node('r')]) }).success,
    ).toBe(true);
  });

  it('rejects unknown types, bad values and oversized input', () => {
    expect(toHost.safeParse({ type: 'runCommand', command: 'rm' }).success).toBe(false);
    expect(toHost.safeParse({ type: 'expand', nodeId: 'a', relation: 'deleteFile' }).success).toBe(
      false,
    );
    expect(toHost.safeParse({ type: 'reveal', nodeId: 'x'.repeat(5000) }).success).toBe(false);
    expect(
      toHost.safeParse({ type: 'explain', nodeId: 'a', pathNodeIds: Array(31).fill('a') }).success,
    ).toBe(false);
    expect(
      toPanel.safeParse({ type: 'graph:init', status: 'ok', graph: { rootId: 'r' } }).success,
    ).toBe(false);
  });
});
