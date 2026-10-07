import type { FlowGraph, FlowNode } from './types';

/**
 * The graph as Mermaid flowchart text, which GitHub, many docs tools and pull
 * requests render as a diagram. Numbered call arrows keep their numbers;
 * "used by" and type relations are dashed, as in the panel.
 */
export function toMermaid(graph: FlowGraph): string {
  const ids = new Map<string, string>();
  const short = (id: string) => {
    let value = ids.get(id);
    if (!value) {
      value = `n${ids.size + 1}`;
      ids.set(id, value);
    }
    return value;
  };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const lines = ['flowchart LR'];

  for (const node of graph.nodes) {
    const label = `${node.kind} ${qualifiedName(node)}<br/>${node.filePath}:${node.line}`;
    const shape = node.members
      ? [`[["`, `"]]`]
      : node.id === graph.rootId
        ? [`(["`, `"])`]
        : [`["`, `"]`];
    lines.push(`  ${short(node.id)}${shape[0]}${escape(label)}${shape[1]}`);
  }

  for (const edge of graph.edges) {
    if (!byId.has(edge.fromId) || !byId.has(edge.toId) || edge.kind === 'contains') {
      continue;
    }
    const from = short(edge.fromId);
    const to = short(edge.toId);
    if (edge.kind === 'calls' && edge.order > 0) {
      lines.push(`  ${from} -->|${edge.order}| ${to}`);
    } else if (edge.kind === 'calls' || edge.kind === 'calledBy') {
      lines.push(`  ${from} --> ${to}`);
    } else {
      const label = edge.kind === 'usedBy' ? 'uses' : edge.kind;
      lines.push(`  ${from} -.->|${label}| ${to}`);
    }
  }

  const root = byId.get(graph.rootId);
  if (root) {
    lines.push(`  style ${short(root.id)} stroke-width:3px`);
  }
  return `${lines.join('\n')}\n`;
}

/** "OrderService.placeOrder" for a method whose class is known, else the plain name. */
function qualifiedName(node: FlowNode): string {
  const match = node.parentId?.match(/#[a-z]+:([^@]+)@\d+:\d+$/);
  return match?.[1] ? `${match[1]}.${node.name}` : node.name;
}

/** Mermaid labels are quoted; quotes and angle brackets become HTML entities. */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;br\/&gt;/g, '<br/>');
}
