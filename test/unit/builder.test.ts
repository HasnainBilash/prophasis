import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCallCache,
  DEFAULT_OPTIONS,
  GraphBuilder,
  MAX_MEMBER_ROWS,
  makeId,
  uniqueSpans,
  type BuilderOptions,
} from '../../src/extension/engine/builder';
import { FakeQueries, pos, sym, WORKSPACE, type FakeProject } from './fakeQueries';

const A = `${WORKSPACE}a.ts`;
const B = `${WORKSPACE}b.ts`;
const LIB = 'file:///lib/lib.d.ts';

// Line numbers below are 0-based, as language servers report them.
const project: FakeProject = {
  files: {
    [A]: {
      lines: [
        'class Shop {', // 0
        '  buy() {', // 1
        '    check(); pay(); pay();', // 2
        '    check(); stringify(x); helper();', // 3
        '  }', // 4
        '  price = 3;', // 5
        '}', // 6
        'function check() { check(); }', // 7
        'function pay() { log(); }', // 8
        'const log = (m) => m;', // 9
        'function isEven(n) { return isOdd(n); }', // 10
        'function isOdd(n) { return isEven(n); }', // 11
        'const limit = 10;', // 12
      ],
      symbols: [
        sym('Shop', 'Class', 0, 6, 6, [
          sym('buy', 'Method', 1, 2, 4),
          sym('price', 'Property', 5, 2),
        ]),
        sym('check', 'Function', 7, 9),
        sym('pay', 'Function', 8, 9),
        sym('log', 'Variable', 9, 6),
        sym('isEven', 'Function', 10, 9),
        sym('isOdd', 'Function', 11, 9),
        sym('limit', 'Constant', 12, 6),
      ],
    },
    [B]: {
      lines: ['export function helper() {}'],
      symbols: [sym('helper', 'Function', 0, 16)],
    },
    [LIB]: {
      lines: ['declare function stringify(value: unknown): string;'],
      symbols: [sym('stringify', 'Function', 0, 17)],
    },
  },
  calls: {
    // pay appears twice on line 2, and the first position is reported twice,
    // as TypeScript and Pylance sometimes do.
    buy: [
      ['pay', [pos(2, 13), pos(2, 20), pos(2, 13)]],
      ['check', [pos(2, 4), pos(3, 4)]],
      ['stringify', [pos(3, 13)]],
      ['helper', [pos(3, 28)]],
    ],
    check: [['check', [pos(7, 19)]]],
    pay: [['log', [pos(8, 17)]]],
    isEven: [['isOdd', [pos(10, 28)]]],
    isOdd: [['isEven', [pos(11, 27)]]],
  },
};

function setup(options: Partial<BuilderOptions> = {}) {
  const queries = new FakeQueries(project);
  const builder = new GraphBuilder(queries, { ...DEFAULT_OPTIONS, ...options });
  return { queries, builder };
}

const id = {
  shop: makeId(A, 'class', 'Shop', pos(0, 6)),
  buy: makeId(A, 'method', 'Shop.buy', pos(1, 2)),
  check: makeId(A, 'function', 'check', pos(7, 9)),
  pay: makeId(A, 'function', 'pay', pos(8, 9)),
  log: makeId(A, 'function', 'log', pos(9, 6)),
  isEven: makeId(A, 'function', 'isEven', pos(10, 9)),
  isOdd: makeId(A, 'function', 'isOdd', pos(11, 9)),
  helper: makeId(B, 'function', 'helper', pos(0, 16)),
};

beforeEach(() => clearCallCache());

describe('starting from a method', () => {
  it('shows the method and what it calls, numbered in code order', async () => {
    const { builder } = setup();
    const { status, graph } = await builder.start(A, pos(2, 6)); // cursor inside buy's body

    expect(status).toBe('ok');
    expect(graph?.rootId).toBe(id.buy);
    const root = graph?.nodes.find((n) => n.id === id.buy);
    expect(root).toMatchObject({ name: 'buy', kind: 'method', parentId: id.shop, line: 2 });
    expect(root?.signature).toBe('buy() {');
    expect(root?.expanded).toEqual(['calls']);

    const edges = graph?.edges.map((e) => [e.toId, e.order, e.callLines]);
    expect(edges).toEqual([
      [id.check, 1, [3, 4]],
      [id.pay, 2, [3]],
      [id.helper, 3, [4]],
    ]);
  });

  it('removes repeated call positions', () => {
    const span = (line: number, ch: number) => ({ start: pos(line, ch), end: pos(line, ch + 1) });
    expect(uniqueSpans([span(2, 13), span(2, 4), span(2, 13)])).toEqual([span(2, 4), span(2, 13)]);
  });

  it('hides library code unless the setting allows it', async () => {
    const hidden = await setup().builder.start(A, pos(1, 3));
    expect(hidden.graph?.nodes.some((n) => n.name === 'stringify')).toBe(false);

    clearCallCache();
    const shown = await setup({ showExternalCode: true }).builder.start(A, pos(1, 3));
    const lib = shown.graph?.nodes.find((n) => n.name === 'stringify');
    expect(lib?.isExternal).toBe(true);
    expect(shown.graph?.edges.find((e) => e.toId === lib?.id)?.order).toBe(3);
  });

  it('leaves out files matching excludeGlobs', async () => {
    const { graph } = await setup({ excludeGlobs: ['b.ts'] }).builder.start(A, pos(1, 3));
    expect(graph?.nodes.map((n) => n.id)).not.toContain(id.helper);
  });

  it('stops at the card limit and counts the rest', async () => {
    const { graph } = await setup({ maxCards: 2 }).builder.start(A, pos(1, 3));
    expect(graph?.nodes.map((n) => n.id)).toEqual([id.buy, id.check]);
    expect(graph?.edges).toHaveLength(1);
    expect(graph?.hiddenCount).toBe(2);
    expect(graph?.truncated).toBe(true);
  });
});

describe('starting from a class', () => {
  it('shows the class with its members as rows, fields included', async () => {
    const { status, graph } = await setup().builder.start(A, pos(0, 7));
    expect(status).toBe('ok');
    const shop = graph?.nodes.find((n) => n.id === id.shop);
    expect(shop?.members).toEqual([
      { id: id.buy, name: 'buy', kind: 'method', line: 2 },
      {
        id: expect.stringContaining('#field:Shop.price@5:2'),
        name: 'price',
        kind: 'field',
        line: 6,
      },
    ]);
    expect(shop?.expanded).toEqual(['contains']);
    expect(graph?.edges).toEqual([]);
  });

  it('turns a member row into a card inside its class when expanded', async () => {
    const { builder } = setup();
    await builder.start(A, pos(0, 7));
    const patch = await builder.expand(id.buy, 'calls');

    expect(patch.addNodes.map((n) => n.id)).toContain(id.buy);
    expect(patch.addEdges[0]).toMatchObject({ fromId: id.shop, toId: id.buy, kind: 'contains' });
    // Calls from a member row start at the member's own id (DATA_MODEL rule 4).
    expect(patch.addEdges.some((e) => e.kind === 'calls' && e.fromId === id.buy)).toBe(true);
  });

  it('caps member rows', async () => {
    const many = Array.from({ length: MAX_MEMBER_ROWS + 5 }, (_, i) =>
      sym(`m${i}`, 'Method', i + 1, 2),
    );
    const big: FakeProject = {
      files: { [A]: { lines: [], symbols: [sym('Big', 'Class', 0, 6, 60, many)] } },
      calls: {},
    };
    const { graph } = await new GraphBuilder(new FakeQueries(big)).start(A, pos(0, 6));
    expect(graph?.nodes[0]?.members).toHaveLength(MAX_MEMBER_ROWS);
    expect(graph?.nodes[0]?.hiddenMembers).toBe(5);
  });
});

describe('loops and recursion', () => {
  it('marks a function that calls itself, without a self-arrow', async () => {
    const { status, graph } = await setup().builder.start(A, pos(7, 10));
    expect(status).toBe('ok');
    expect(graph?.nodes[0]?.isRecursive).toBe(true);
    expect(graph?.edges).toEqual([]);
  });

  it('marks the card a call cycle returns to', async () => {
    const { builder } = setup();
    await builder.start(A, pos(10, 10));
    const patch = await builder.expand(id.isOdd, 'calls');

    expect(patch.addEdges).toEqual([
      expect.objectContaining({ fromId: id.isOdd, toId: id.isEven }),
    ]);
    expect(patch.updateNodes.find((n) => n.id === id.isEven)?.isRecursive).toBe(true);
    // Unique ids mean the cycle is one arrow each way, never an endless chain.
    expect(builder.snapshot().nodes).toHaveLength(2);
  });
});

describe('called by', () => {
  it('adds callers without numbers, then numbers them once the caller is expanded', async () => {
    const { builder } = setup();
    await builder.start(A, pos(8, 10)); // pay
    clearCallCache();
    await builder.expand(id.pay, 'calledBy');
    const before = builder.snapshot().edges.find((e) => e.fromId === id.buy);
    expect(before).toMatchObject({ toId: id.pay, kind: 'calledBy', order: 0, callLines: [3] });

    const patch = await builder.expand(id.buy, 'calls');
    const after = builder.snapshot().edges.filter((e) => e.fromId === id.buy && e.toId === id.pay);
    expect(after).toEqual([expect.objectContaining({ kind: 'calls', order: 2 })]);
    expect(patch.addEdges.some((e) => e.id === before?.id)).toBe(true);
  });

  it('gives a symbol the same id however it was reached', async () => {
    const { builder } = setup();
    await builder.start(A, pos(1, 3)); // buy → pay found through a call
    clearCallCache();
    const direct = await setup().builder.start(A, pos(8, 10)); // pay as the start
    expect(builder.snapshot().nodes.map((n) => n.id)).toContain(direct.graph?.rootId);
  });
});

describe('statuses', () => {
  it('a function stored in a variable can be a starting point', async () => {
    const { status, graph } = await setup().builder.start(A, pos(9, 7));
    expect(graph?.nodes[0]).toMatchObject({ id: id.log, name: 'log', kind: 'function' });
    expect(status).toBe('empty'); // log calls nothing
  });

  it('a plain constant is not a starting point', async () => {
    expect((await setup().builder.start(A, pos(12, 7))).status).toBe('noSymbol');
  });

  it('no symbols in a file just opened means the language server is starting', async () => {
    const { builder, queries } = setup();
    queries.recentlyOpened = true;
    expect((await builder.start(`${WORKSPACE}new.ts`, pos(0, 0))).status).toBe(
      'languageServerStarting',
    );
  });

  it('no symbols in a file open for a while means the language is unsupported', async () => {
    const { builder } = setup();
    expect((await builder.start(`${WORKSPACE}new.ts`, pos(0, 0))).status).toBe('unsupported');
  });
});

describe('cache', () => {
  it('reuses answers for the same file version and asks again after an edit', async () => {
    const first = setup();
    await first.builder.start(A, pos(1, 3));
    expect(first.queries.calls.outgoing).toBe(1);

    const second = setup();
    await second.builder.start(A, pos(1, 3));
    expect(second.queries.calls.outgoing).toBe(0);

    const edited = setup();
    edited.queries.version = 2;
    await edited.builder.start(A, pos(1, 3));
    expect(edited.queries.calls.outgoing).toBe(1);
  });

  it("doesn't keep empty answers, which may come from a server still warming up", async () => {
    const first = setup();
    await first.builder.start(A, pos(9, 7)); // log calls nothing
    const second = setup();
    await second.builder.start(A, pos(9, 7));
    expect(second.queries.calls.outgoing).toBe(1);
  });
});

describe('collapse', () => {
  it('removes what Calls showed, and cards no longer connected', async () => {
    const { builder } = setup();
    await builder.start(A, pos(1, 3)); // buy → check, pay, helper
    await builder.expand(id.pay, 'calls'); // pay → log
    const patch = builder.collapse(id.buy, 'calls');

    const left = builder.snapshot();
    expect(left.nodes.map((n) => n.id)).toEqual([id.buy]);
    expect(left.edges).toEqual([]);
    expect(patch.removeIds).toEqual(expect.arrayContaining([id.check, id.pay, id.helper, id.log]));
    expect(patch.updateNodes[0]?.expanded).toEqual([]);
  });

  it("keeps an arrow that the other card's own expansion also shows", async () => {
    const { builder } = setup();
    await builder.start(A, pos(8, 10)); // pay → log
    await builder.expand(id.pay, 'calledBy'); // buy → pay
    await builder.expand(id.buy, 'calls'); // buy → check, pay, helper
    builder.collapse(id.pay, 'calledBy');

    // buy → pay stays: it is one of buy's own calls, which are still shown.
    const edges = builder.snapshot().edges.map((e) => `${e.fromId}->${e.toId}`);
    expect(edges).toContain(`${id.buy}->${id.pay}`);
    expect(builder.snapshot().nodes.map((n) => n.id)).toContain(id.check);
  });

  it('never removes the start card, and can expand again afterwards', async () => {
    const { builder } = setup();
    await builder.start(A, pos(1, 3));
    builder.collapse(id.buy, 'calls');
    const again = await builder.expand(id.buy, 'calls');
    expect(again.addNodes.map((n) => n.id)).toEqual([id.check, id.pay, id.helper]);
    expect(builder.snapshot().edges.map((e) => e.order)).toEqual([1, 2, 3]);
  });
});

describe('call order', () => {
  it('follows where each called name is written, also in chained calls', async () => {
    const F = `${WORKSPACE}chain.ts`;
    const project: FakeProject = {
      files: {
        [F]: {
          lines: [
            'function run() {',
            '  getPlugin(x).generate(1);',
            '}',
            'function getPlugin() {}',
            'function generate() {}',
          ],
          symbols: [
            sym('run', 'Function', 0, 9, 2),
            sym('getPlugin', 'Function', 3, 9),
            sym('generate', 'Function', 4, 9),
          ],
        },
      },
      calls: {},
    };
    const queries = new FakeQueries(project);
    const item = async (name: string) => {
      const [found] = await queries.prepareCallHierarchy(F, pos(name === 'getPlugin' ? 3 : 4, 10));
      if (!found) {
        throw new Error(`no ${name} in the fake project`);
      }
      return found;
    };
    // As TypeScript reports them: both calls start where the expression starts.
    queries.outgoingCalls = async () => [
      { item: await item('generate'), ranges: [{ start: pos(1, 2), end: pos(1, 24) }] },
      { item: await item('getPlugin'), ranges: [{ start: pos(1, 2), end: pos(1, 11) }] },
    ];
    const { graph } = await new GraphBuilder(queries).start(F, pos(0, 10));
    const names = new Map(graph?.nodes.map((n) => [n.id, n.name]));
    expect(graph?.edges.map((e) => `${e.order} ${names.get(e.toId)}`)).toEqual([
      '1 getPlugin',
      '2 generate',
    ]);
  });
});
