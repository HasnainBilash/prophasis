import { describe, expect, it } from 'vitest';
import { toMermaid } from '../../src/shared/mermaid';
import type { FlowEdge, FlowGraph, FlowNode } from '../../src/shared/types';

const node = (id: string, fields: Partial<FlowNode> = {}): FlowNode => ({
  id,
  name: id,
  kind: 'function',
  filePath: 'src/a.ts',
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
  order: 0,
  callLines: [],
  ...fields,
});

describe('toMermaid', () => {
  it('writes cards and numbered call arrows, with the start card stressed', () => {
    const graph: FlowGraph = {
      rootId: 'root',
      nodes: [
        node('root', {
          name: 'placeOrder',
          kind: 'method',
          line: 12,
          parentId: 'file:///w/src/o.ts#class:OrderService@6:13',
        }),
        node('a', { name: 'validateCart', line: 6 }),
        node('caller', { name: 'main' }),
      ],
      edges: [edge('root', 'a', { order: 1 }), edge('caller', 'root', { kind: 'calledBy' })],
      hiddenCount: 0,
      truncated: false,
    };
    expect(toMermaid(graph)).toBe(
      [
        'flowchart LR',
        '  n1(["method OrderService.placeOrder<br/>src/a.ts:12"])',
        '  n2["function validateCart<br/>src/a.ts:6"]',
        '  n3["function main<br/>src/a.ts:1"]',
        '  n1 -->|1| n2',
        '  n3 --> n1',
        '  style n1 stroke-width:3px',
        '',
      ].join('\n'),
    );
  });

  it('draws uses and type relations dashed, classes boxed, and escapes names', () => {
    const graph: FlowGraph = {
      rootId: 'I',
      nodes: [
        node('I', { kind: 'interface', name: 'Box<"T">', members: [] }),
        node('C', { kind: 'class', members: [] }),
      ],
      edges: [edge('C', 'I', { kind: 'implements' }), edge('C', 'I', { id: 'u', kind: 'usedBy' })],
      hiddenCount: 0,
      truncated: false,
    };
    const text = toMermaid(graph);
    expect(text).toContain('n1[["interface Box&lt;&quot;T&quot;&gt;<br/>src/a.ts:1"]]');
    expect(text).toContain('n2 -.->|implements| n1');
    expect(text).toContain('n2 -.->|uses| n1');
  });
});
