import dagre from '@dagrejs/dagre';
import type { FlowEdge, FlowNode } from '../shared/types';

// Card sizes are fixed by the stylesheet (one line per field, fixed row
// height), so the layout can be computed before anything is drawn.
export const CARD = {
  width: 240,
  classWidth: 280,
  height: 128,
  classHeader: 92,
  row: 26,
  actions: 40,
} as const;

export interface CardBox {
  id: string;
  node: FlowNode;
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
  if (!node.members) {
    return { width: CARD.width, height: CARD.height };
  }
  const rows = node.members.length + (node.hiddenMembers ? 1 : 0);
  return {
    width: CARD.classWidth,
    height: CARD.classHeader + Math.max(rows, 1) * CARD.row + CARD.actions,
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

  for (const edge of edges) {
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

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of drawn) {
    g.setNode(node.id, cardSize(node));
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
