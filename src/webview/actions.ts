import { createContext, useContext } from 'react';
import type { FlowNode, NodeKind, Relation } from '../shared/types';

/** What cards can do, provided once by the app instead of copied into every card. */
export interface CardActions {
  expand(nodeId: string, relation: Relation): void;
  /** Hides what an expansion showed. */
  collapse(nodeId: string, relation: Relation): void;
  reveal(nodeId: string): void;
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
