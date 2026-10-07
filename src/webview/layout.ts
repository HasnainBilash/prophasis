import dagre from '@dagrejs/dagre';
import type { FlowEdge, FlowNode, Relation } from '../shared/types';

// Card sizes are fixed by the stylesheet (one line per field, fixed row
// height), so the layout can be computed before anything is drawn.
export const CARD = {
  width: 240,
  classWidth: 280,
  height: 128,
  classHeader: 92,
  row: 26,
  actions: 40,
  moreHeight: 64,
  doc: 18,
} as const;

/** A "+N more" box: cards an expansion left out, loaded on click. */
export interface MoreBox {
  ownerId: string;
  relation: Relation;
  count: number;
}

export interface CardBox {
  id: string;
  /** A real card; absent for a "+N more" box. */
  node?: FlowNode;
  more?: MoreBox;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Arrow {
  edge: FlowEdge;
  /** Card the arrow leaves from, and the row handle if it leaves from a class member row. */
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  /** Kind of the calling card or member, for the arrow colour. */
  callerKind: string;
  /** Both ends are rows of the same class card. */
  sameCard: boolean;
  /** The dashed link to a "+N more" box. */
  toMore?: boolean;
}

export interface Layout {
  cards: CardBox[];
  arrows: Arrow[];
}

/** Handle ids on a card: whole-card ends, and per-row ends on class cards. */
export const handle = {
  out: 'out',
  in: 'in',
  rowOut: (memberId: string) => `out:${memberId}`,
  rowIn: (memberId: string) => `in:${memberId}`,
  rowLoop: (memberId: string) => `loop:${memberId}`,
};

export function cardSize(node: FlowNode): { width: number; height: number } {
  // A doc comment adds one line under the name.
  const doc = node.docComment ? CARD.doc : 0;
  if (!node.members) {
    return { width: CARD.width, height: CARD.height + doc };
  }
  const rows = node.members.length + (node.hiddenMembers ? 1 : 0);
  return {
    width: CARD.classWidth,
    height: CARD.classHeader + doc + Math.max(rows, 1) * CARD.row + CARD.actions,
  };
}

/**
 * A method whose class card is on the canvas is drawn as a row of that card,
 * not as its own card. Returns the class id for such a member.
 */
function hostOf(node: FlowNode, nodes: Map<string, FlowNode>): string | undefined {
  if (!node.parentId) {
    return undefined;
  }
  const parent = nodes.get(node.parentId);
  return parent?.members?.some((m) => m.id === node.id) ? parent.id : undefined;
}

/** Turns the graph into positioned cards and arrows, laid out left to right. */
export function layoutGraph(nodes: Map<string, FlowNode>, edges: FlowEdge[]): Layout {
  const drawn = [...nodes.values()].filter((n) => !hostOf(n, nodes));
  const arrows: Arrow[] = [];
  const pairs = new Set<string>();

  // "Used by" goes last: when two cards are also joined by a call or a type
  // relation, that stronger arrow is drawn and the "used by" one is not.
  const ordered = [...edges].sort(
    (a, b) => Number(a.kind === 'usedBy') - Number(b.kind === 'usedBy'),
  );
  for (const edge of ordered) {
    const from = nodes.get(edge.fromId);
    const to = nodes.get(edge.toId);
    if (!from || !to) {
      continue;
    }
    const fromHost = hostOf(from, nodes);
    const toHost = hostOf(to, nodes);
    // "Contains" is already visible as the row itself.
    if (edge.kind === 'contains' && toHost) {
      continue;
    }
    const source = fromHost ?? from.id;
    const target = toHost ?? to.id;
    const sameCard = source === target;
    const pair = [source, target].sort().join('|');
    if (edge.kind === 'usedBy' && pairs.has(pair)) {
      continue;
    }
    pairs.add(pair);
    arrows.push({
      edge,
      source,
      sourceHandle: fromHost ? handle.rowOut(from.id) : handle.out,
      target,
      targetHandle: toHost ? (sameCard ? handle.rowLoop(to.id) : handle.rowIn(to.id)) : handle.in,
      callerKind: from.kind,
      sameCard,
    });
  }

  // "+N more" boxes sit on the side their relationship points to: callees on
  // the right, callers, users and child types on the left.
  const moreBoxes: { id: string; more: MoreBox; owner: string }[] = [];
  for (const node of nodes.values()) {
    for (const [relation, count] of Object.entries(node.more ?? {}) as [Relation, number][]) {
      if (count > 0) {
        const owner = hostOf(node, nodes) ?? node.id;
        moreBoxes.push({
          id: `more:${node.id}:${relation}`,
          more: { ownerId: node.id, relation, count },
          owner,
        });
      }
    }
  }
  for (const box of moreBoxes) {
    const outward = box.more.relation === 'calls';
    arrows.push({
      edge: {
        id: box.id,
        fromId: outward ? box.more.ownerId : box.id,
        toId: outward ? box.id : box.more.ownerId,
        kind: 'calls',
        order: 0,
        callLines: [],
      },
      source: outward ? box.owner : box.id,
      sourceHandle: handle.out,
      target: outward ? box.id : box.owner,
      targetHandle: handle.in,
      callerKind: 'more',
      sameCard: false,
      toMore: true,
    });
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of drawn) {
    g.setNode(node.id, cardSize(node));
  }
  for (const box of moreBoxes) {
    g.setNode(box.id, { width: CARD.width, height: CARD.moreHeight });
  }
  for (const arrow of arrows) {
    if (!arrow.sameCard) {
      g.setEdge(arrow.source, arrow.target);
    }
  }
  dagre.layout(g);

  const cards = drawn.map((node): CardBox => {
    const { width, height } = cardSize(node);
    const placed = g.node(node.id);
    // dagre gives centres; the canvas wants top-left corners.
    return { id: node.id, node, x: placed.x - width / 2, y: placed.y - height / 2, width, height };
  });
  for (const box of moreBoxes) {
    const placed = g.node(box.id);
    cards.push({
      id: box.id,
      more: box.more,
      x: placed.x - CARD.width / 2,
      y: placed.y - CARD.moreHeight / 2,
      width: CARD.width,
      height: CARD.moreHeight,
    });
  }
  stackInCallOrder(cards, arrows);
  return { cards, arrows };
}

/** Vertical gap between cards in a column. */
const GAP = 28;

/**
 * dagre picks its own top-to-bottom order inside a column. People read the
 * arrow numbers top to bottom, so each column is re-stacked: cards reached by
 * call 1 first, then call 2, and so on; cards without a number keep their place
 * after them.
 */
export function stackInCallOrder(cards: CardBox[], arrows: Arrow[]): void {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const columns = new Map<number, CardBox[]>();
  for (const card of cards) {
    const key = Math.round(card.x + card.width / 2);
    columns.set(key, [...(columns.get(key) ?? []), card]);
  }
  const orderOf = (card: CardBox) => {
    let best = Number.POSITIVE_INFINITY;
    for (const arrow of arrows) {
      const from = byId.get(arrow.source);
      if (arrow.target === card.id && arrow.edge.order > 0 && from && from.x < card.x) {
        best = Math.min(best, arrow.edge.order);
      }
    }
    return best;
  };
  for (const column of columns.values()) {
    if (column.length < 2) {
      continue;
    }
    const top = Math.min(...column.map((c) => c.y));
    const sorted = column
      .map((card) => ({ card, order: orderOf(card), y: card.y }))
      .sort((a, b) => a.order - b.order || a.y - b.y);
    let cursor = top;
    for (const { card } of sorted) {
      card.y = cursor;
      cursor += card.height + GAP;
    }
  }
}

/**
 * The flow through a card: everything that leads to it and everything it
 * leads to, following the arrows on the canvas.
 */
export function pathThrough(cardId: string, arrows: Arrow[]): Set<string> {
  const seen = new Set<string>([cardId]);
  for (const forward of [true, false]) {
    const queue = [cardId];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const arrow of arrows) {
        const from = forward ? arrow.source : arrow.target;
        const to = forward ? arrow.target : arrow.source;
        if (from === id && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
  }
  return seen;
}

/**
 * The shortest call path between the start card and another card, in call
 * order (caller first): forward along calls when the start leads to it,
 * otherwise backward when it leads to the start (a caller). Undefined when
 * the two aren't connected by calls.
 */
export function callPath(
  rootId: string,
  targetId: string,
  edges: FlowEdge[],
): string[] | undefined {
  const calls = edges.filter((e) => e.kind === 'calls' || e.kind === 'calledBy');
  const search = (from: string, to: string): string[] | undefined => {
    const previous = new Map<string, string>([[from, from]]);
    const queue = [from];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (id === to) {
        const path = [to];
        for (let step = to; step !== from;) {
          step = previous.get(step) ?? from;
          path.unshift(step);
        }
        return path;
      }
      for (const edge of calls) {
        if (edge.fromId === id && !previous.has(edge.toId)) {
          previous.set(edge.toId, id);
          queue.push(edge.toId);
        }
      }
    }
    return undefined;
  };
  return search(rootId, targetId) ?? search(targetId, rootId);
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * The card to move keyboard focus to: right goes to the first card this one
 * points to (lowest arrow number first), left to the first card pointing to
 * it, up and down to the next card in the same column.
 */
export function neighbour(
  layout: Layout,
  cardId: string,
  direction: Direction,
): string | undefined {
  const cards = layout.cards.filter((c) => c.node);
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    return undefined;
  }
  const arrows = layout.arrows.filter((a) => !a.toMore && !a.sameCard);
  const byOrder = (a: Arrow, b: Arrow) => (a.edge.order || Infinity) - (b.edge.order || Infinity);
  if (direction === 'right') {
    return arrows.filter((a) => a.source === cardId).sort(byOrder)[0]?.target;
  }
  if (direction === 'left') {
    return arrows.filter((a) => a.target === cardId).sort(byOrder)[0]?.source;
  }
  const centre = (c: CardBox) => c.x + c.width / 2;
  const column = cards
    .filter((c) => Math.abs(centre(c) - centre(card)) < 1)
    .sort((a, b) => a.y - b.y);
  const index = column.findIndex((c) => c.id === cardId);
  return column[direction === 'up' ? index - 1 : index + 1]?.id;
}
