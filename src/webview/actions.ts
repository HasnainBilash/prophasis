import { createContext, useContext } from 'react';
import type { FlowNode, NodeKind, Relation } from '../shared/types';

/** What cards can do, provided once by the app instead of copied into every card. */
export interface CardActions {
  /** `all`: also load what a "+N more" card left out. */
  expand(nodeId: string, relation: Relation, all?: boolean): void;
  /** Hides what an expansion showed. */
  collapse(nodeId: string, relation: Relation): void;
  reveal(nodeId: string): void;
  /** Explains a card, or with `path` the call path from the start card to it. */
  explain(nodeId: string, path?: boolean): void;
  isPending(nodeId: string, relation: Relation): boolean;
  /** A member row's own card data, once it has been expanded. */
  nodeById(nodeId: string): FlowNode | undefined;
}

export const ActionsContext = createContext<CardActions | null>(null);

export function useActions(): CardActions {
  const actions = useContext(ActionsContext);
  if (!actions) {
    throw new Error('Card rendered outside the graph');
  }
  return actions;
}

/** Short glyph and readable label for each kind. Kind is never shown by colour alone. */
export const kindInfo: Record<NodeKind | 'field', { glyph: string; label: string }> = {
  function: { glyph: 'ƒ', label: 'function' },
  method: { glyph: 'm', label: 'method' },
  constructor: { glyph: '+', label: 'constructor' },
  class: { glyph: 'C', label: 'class' },
  interface: { glyph: 'I', label: 'interface' },
  struct: { glyph: 'S', label: 'struct' },
  enum: { glyph: 'E', label: 'enum' },
  field: { glyph: '·', label: 'field' },
};

/**
 * A method or constructor shown as its own card is named with its class
 * ("OrderService.constructor"), since the class card isn't there to say so.
 * The class name comes from the parent's id: `<uri>#<kind>:<qualified name>@<line>:<col>`.
 */
export function displayName(node: FlowNode): string {
  const match = node.parentId?.match(/#[a-z]+:([^@]+)@\d+:\d+$/);
  return match?.[1] ? `${match[1]}.${node.name}` : node.name;
}
