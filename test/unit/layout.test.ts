import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '../../src/shared/types';
import { CARD, cardSize, handle, layoutGraph, pathThrough } from '../../src/webview/layout';

function node(id: string, fields: Partial<FlowNode> = {}): FlowNode {
  return {
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
  };
}

function call(fromId: string, toId: string, order: number): FlowEdge {
  return { id: `${fromId}->${toId}`, fromId, toId, kind: 'calls', order, callLines: [order] };
}

const map = (...nodes: FlowNode[]) => new Map(nodes.map((n) => [n.id, n]));

describe('layoutGraph', () => {
  it('stacks callees top to bottom in call order', () => {
    const nodes = map(node('root'), node('a'), node('b'), node('c'));
    // Edges listed out of order on purpose.
    const edges = [call('root', 'c', 3), call('root', 'a', 1), call('root', 'b', 2)];
    const { cards } = layoutGraph(nodes, edges);
    const y = (id: string) => cards.find((c) => c.id === id)?.y ?? NaN;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('c'));
  });

  it('places callers left of the start and callees right of it', () => {
    const nodes = map(node('caller'), node('root'), node('callee'));
    const edges = [call('caller', 'root', 1), call('root', 'callee', 1)];
    const { cards } = layoutGraph(nodes, edges);
    const x = (id: string) => cards.find((c) => c.id === id)?.x ?? NaN;
    expect(x('caller')).toBeLessThan(x('root'));
    expect(x('root')).toBeLessThan(x('callee'));
  });

  it('draws an expanded member as a row of its class, with arrows leaving from the row', () => {
    const cls = node('Shop', {
      kind: 'class',
      members: [
        { id: 'buy', name: 'buy', kind: 'method', line: 2 },
        { id: 'pay', name: 'pay', kind: 'method', line: 5 },
      ],
    });
    const nodes = map(
      cls,
      node('buy', { kind: 'method', parentId: 'Shop' }),
      node('pay', { kind: 'method', parentId: 'Shop' }),
      node('check'),
    );
    const edges: FlowEdge[] = [
      { ...call('Shop', 'buy', 0), kind: 'contains' },
      call('buy', 'check', 1),
      call('buy', 'pay', 2),
    ];
    const { cards, arrows } = layoutGraph(nodes, edges);

    expect(cards.map((c) => c.id).sort()).toEqual(['Shop', 'check']);
    expect(arrows).toHaveLength(2); // the "contains" edge is the row itself
    expect(arrows[0]).toMatchObject({
      source: 'Shop',
      sourceHandle: handle.rowOut('buy'),
      target: 'check',
      targetHandle: handle.in,
      callerKind: 'method',
      sameCard: false,
    });
    // A call between two rows of the same card loops on the card's right side.
    expect(arrows[1]).toMatchObject({
      source: 'Shop',
      target: 'Shop',
      targetHandle: handle.rowLoop('pay'),
      sameCard: true,
    });
  });

  it('sizes class cards by their rows', () => {
    const cls = node('C', {
      kind: 'class',
      members: [{ id: 'm', name: 'm', kind: 'method', line: 2 }],
      hiddenMembers: 3,
    });
    expect(cardSize(cls)).toEqual({
      width: CARD.classWidth,
      height: CARD.classHeader + 2 * CARD.row + CARD.actions,
    });
    expect(cardSize(node('f'))).toEqual({ width: CARD.width, height: CARD.height });
  });
});

describe('pathThrough (hover highlight)', () => {
  it('lights everything leading to and from a card, nothing else', () => {
    const nodes = map(node('main'), node('root'), node('a'), node('b'), node('deep'));
    const edges = [
      call('main', 'root', 1),
      call('root', 'a', 1),
      call('root', 'b', 2),
      call('a', 'deep', 1),
    ];
    const { arrows } = layoutGraph(nodes, edges);
    expect([...pathThrough('a', arrows)].sort()).toEqual(['a', 'deep', 'main', 'root']);
  });
});
