import { beforeEach, describe, expect, it } from 'vitest';
import { clearCallCache, FAN_OUT, GraphBuilder, makeId } from '../../src/extension/engine/builder';
import { FakeQueries, pos, sym, WORKSPACE, type FakeProject } from './fakeQueries';

const T = `${WORKSPACE}types.ts`;

// 0-based lines.
const project = (typeHierarchy: boolean): FakeProject => ({
  files: {
    [T]: {
      lines: [
        'interface Shape {', // 0
        '  area(): number;', // 1
        '}', // 2
        'class Circle implements Shape {', // 3
        '  area() { return 1; }', // 4
        '}', // 5
        'class Ring extends Circle {}', // 6
        'function draw(s: Shape) {', // 7
        '  const c = new Circle();', // 8
        '}', // 9
        'const x: Shape = new Ring();', // 10
      ],
      symbols: [
        sym('Shape', 'Interface', 0, 10, 2, [sym('area', 'Method', 1, 2)]),
        sym('Circle', 'Class', 3, 6, 5, [sym('area', 'Method', 4, 2)]),
        sym('Ring', 'Class', 6, 6),
        sym('draw', 'Function', 7, 9, 9),
        sym('x', 'Constant', 10, 6),
      ],
    },
  },
  calls: {},
  references: {
    Shape: [
      [T, pos(0, 10)], // the declaration itself
      [T, pos(3, 24)], // "implements Shape" inside Circle
      [T, pos(7, 17)], // parameter type inside draw
      [T, pos(10, 9)], // top level: no card to belong to
    ],
  },
  parents: { Circle: ['Shape'], Ring: ['Circle'] },
  typeHierarchy,
});

const id = {
  shape: makeId(T, 'interface', 'Shape', pos(0, 10)),
  circle: makeId(T, 'class', 'Circle', pos(3, 6)),
  ring: makeId(T, 'class', 'Ring', pos(6, 6)),
  draw: makeId(T, 'function', 'draw', pos(7, 9)),
};

const arrows = (builder: GraphBuilder) =>
  builder
    .snapshot()
    .edges.map((e) => `${e.fromId.split('#')[1]} -${e.kind}-> ${e.toId.split('#')[1]}`);

beforeEach(() => clearCallCache());

describe('used by', () => {
  it('groups references by the function or class they are written in', async () => {
    const builder = new GraphBuilder(new FakeQueries(project(true)));
    await builder.start(T, pos(0, 11));
    await builder.expand(id.shape, 'usedBy');

    expect(arrows(builder).sort()).toEqual([
      'class:Circle@3:6 -usedBy-> interface:Shape@0:10',
      'function:draw@7:9 -usedBy-> interface:Shape@0:10',
    ]);
    const draw = builder.snapshot().edges.find((e) => e.fromId === id.draw);
    expect(draw?.callLines).toEqual([8]);
  });

  it('collapses like any other expansion', async () => {
    const builder = new GraphBuilder(new FakeQueries(project(true)));
    await builder.start(T, pos(0, 11));
    await builder.expand(id.shape, 'usedBy');
    builder.collapse(id.shape, 'usedBy');
    expect(builder.snapshot().nodes.map((n) => n.id)).toEqual([id.shape]);
  });
});

describe('extends', () => {
  it('with a type hierarchy (Python): shows parents and children', async () => {
    const builder = new GraphBuilder(new FakeQueries(project(true)));
    await builder.start(T, pos(3, 7));
    await builder.expand(id.circle, 'extends');

    expect(arrows(builder).sort()).toEqual([
      'class:Circle@3:6 -implements-> interface:Shape@0:10',
      'class:Ring@6:6 -extends-> class:Circle@3:6',
    ]);
  });

  it('without one (TypeScript): shows children only, never the type itself', async () => {
    const builder = new GraphBuilder(new FakeQueries(project(false)));
    await builder.start(T, pos(0, 11));
    await builder.expand(id.shape, 'extends');
    expect(arrows(builder)).toEqual(['class:Circle@3:6 -implements-> interface:Shape@0:10']);

    await builder.expand(id.circle, 'extends');
    expect(arrows(builder)).toContain('class:Ring@6:6 -extends-> class:Circle@3:6');
  });
});

describe('fan-out', () => {
  const F = `${WORKSPACE}hub.ts`;
  const count = FAN_OUT + 3;
  const big: FakeProject = {
    files: {
      [F]: {
        lines: [],
        symbols: [
          sym('hub', 'Function', 0, 9, 0),
          ...Array.from({ length: count }, (_, i) => sym(`f${i}`, 'Function', i + 1, 9)),
        ],
      },
    },
    calls: {
      hub: Array.from(
        { length: count },
        (_, i) => [`f${i}`, [pos(0, 20 + i)]] as [string, ReturnType<typeof pos>[]],
      ),
    },
  };

  it('adds the first cards and counts the rest as "+N more"', async () => {
    const builder = new GraphBuilder(new FakeQueries(big));
    const { graph } = await builder.start(F, pos(0, 10));
    const hub = graph?.nodes.find((n) => n.name === 'hub');
    expect(graph?.nodes).toHaveLength(1 + FAN_OUT);
    expect(hub?.more).toEqual({ calls: 3 });
    // Numbers stay in code order and stop at the cut.
    expect(graph?.edges.map((e) => e.order)).toEqual(
      Array.from({ length: FAN_OUT }, (_, i) => i + 1),
    );
  });

  it('loads the rest when asked for all', async () => {
    const builder = new GraphBuilder(new FakeQueries(big));
    const { graph } = await builder.start(F, pos(0, 10));
    const patch = await builder.expand(graph?.rootId ?? '', 'calls', true);
    expect(patch.addNodes).toHaveLength(3);
    expect(builder.snapshot().nodes.find((n) => n.name === 'hub')?.more).toBeUndefined();
    expect(builder.snapshot().edges).toHaveLength(count);
  });
});

describe('class properties holding a function', () => {
  const P = `${WORKSPACE}immer.ts`;
  const props: FakeProject = {
    files: {
      [P]: {
        lines: [
          'class Immer {', // 0
          '  autoFreeze = true;', // 1
          '  produce: IProduce = (base: any, recipe?: any) => {', // 2
          '    return base;', // 3
          '  };', // 4
          '}', // 5
        ],
        symbols: [
          sym('Immer', 'Class', 0, 6, 5, [
            sym('autoFreeze', 'Property', 1, 2),
            sym('produce', 'Property', 2, 2, 4),
          ]),
        ],
      },
    },
    calls: {},
  };

  it('lists them as method rows, and other properties as fields', async () => {
    const { graph } = await new GraphBuilder(new FakeQueries(props)).start(P, pos(0, 7));
    expect(graph?.nodes[0]?.members?.map((m) => `${m.kind} ${m.name}`)).toEqual([
      'field autoFreeze',
      'method produce',
    ]);
  });

  it('can be a starting point, as a method of its class', async () => {
    const { graph } = await new GraphBuilder(new FakeQueries(props)).start(P, pos(3, 6));
    expect(graph?.nodes[0]).toMatchObject({ name: 'produce', kind: 'method' });
  });
});

describe("calls to members the file's symbols don't list", () => {
  it('names the card after the member, inside its type', async () => {
    const F = `${WORKSPACE}plugin.ts`;
    const project: FakeProject = {
      files: {
        [F]: {
          lines: [
            'type Plugin = {', // 0
            '  generate(x: number): void', // 1
            '}', // 2
            'function run(p: Plugin) {', // 3
            '  p.generate(1);', // 4
            '}', // 5
          ],
          // TypeScript lists the type alias but not its members.
          symbols: [sym('Plugin', 'Variable', 0, 5, 2), sym('run', 'Function', 3, 9, 5)],
        },
      },
      calls: {},
    };
    const queries = new FakeQueries(project);
    // The call target is a member that only the call hierarchy knows about.
    queries.outgoingCalls = async () => [
      {
        item: {
          name: 'generate',
          kind: 'Method',
          uri: F,
          range: { start: pos(1, 2), end: pos(1, 27) },
          selectionRange: { start: pos(1, 2), end: pos(1, 10) },
          handle: null,
        },
        ranges: [{ start: pos(4, 4), end: pos(4, 12) }],
      },
    ];
    const { graph } = await new GraphBuilder(queries).start(F, pos(3, 10));
    const target = graph?.nodes.find((n) => n.id !== graph.rootId);
    expect(target).toMatchObject({ name: 'generate', kind: 'method', line: 2 });
    expect(target?.parentId).toContain('Plugin@0:5');
  });
});
