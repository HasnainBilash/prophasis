/**
 * Feasibility probe. Runs inside a real VS Code (Extension Development Host)
 * opened on test/fixtures/fixtures.code-workspace, asks the language servers
 * every question Prophasis depends on, and writes the raw answers to a JSON
 * file. It checks nothing itself; the results are read and judged by a person.
 */
import { writeFileSync } from 'node:fs';
import * as vscode from 'vscode';

interface Target {
  language: 'typescript' | 'javascript' | 'python';
  /** Path inside the fixtures folder, e.g. "ts/src/orders/orderService.ts". */
  file: string;
  /** Symbol name as the language server reports it. */
  symbol: string;
  /** Also ask the type hierarchy and implementation providers. */
  types?: boolean;
}

const targets: Target[] = [
  { language: 'typescript', file: 'ts/src/orders/orderService.ts', symbol: 'placeOrder' },
  {
    language: 'typescript',
    file: 'ts/src/orders/orderService.ts',
    symbol: 'OrderService',
    types: true,
  },
  { language: 'typescript', file: 'ts/src/orders/orderService.ts', symbol: 'chargePayment' },
  { language: 'typescript', file: 'ts/src/cart/validate.ts', symbol: 'validateCart' },
  { language: 'typescript', file: 'ts/src/notify/email.ts', symbol: 'retry' },
  { language: 'typescript', file: 'ts/src/notify/email.ts', symbol: 'isEven' },
  {
    language: 'typescript',
    file: 'ts/src/payments/gateway.ts',
    symbol: 'PaymentProvider',
    types: true,
  },
  { language: 'typescript', file: 'ts/src/payments/gateway.ts', symbol: 'charge', types: true },
  { language: 'javascript', file: 'js/src/shapes.js', symbol: 'Shape', types: true },
  { language: 'javascript', file: 'js/src/shapes.js', symbol: 'describe' },
  { language: 'javascript', file: 'js/src/shapes.js', symbol: 'square' },
  { language: 'javascript', file: 'js/src/shapes.js', symbol: 'format' },
  { language: 'javascript', file: 'js/src/report.js', symbol: 'buildReport' },
  { language: 'javascript', file: 'js/src/report.js', symbol: 'countdown' },
  { language: 'python', file: 'py/shop/orders/order_service.py', symbol: 'place_order' },
  {
    language: 'python',
    file: 'py/shop/orders/order_service.py',
    symbol: 'OrderService',
    types: true,
  },
  { language: 'python', file: 'py/shop/cart/validate.py', symbol: 'validate_cart' },
  { language: 'python', file: 'py/shop/notify/email.py', symbol: 'retry' },
  { language: 'python', file: 'py/shop/notify/email.py', symbol: 'is_even' },
  {
    language: 'python',
    file: 'py/shop/payments/gateway.py',
    symbol: 'PaymentProvider',
    types: true,
  },
  { language: 'python', file: 'py/shop/payments/gateway.py', symbol: 'charge', types: true },
];

// Files whose symbols are listed in full, to check what a class card would show.
const symbolFiles = [
  'ts/src/orders/orderService.ts',
  'ts/src/payments/gateway.ts',
  'js/src/shapes.js',
  'py/shop/orders/order_service.py',
  'py/shop/payments/gateway.py',
];

const symbolIconNames = [
  'function',
  'method',
  'constructor',
  'class',
  'interface',
  'struct',
  'enumerator',
  'field',
  'property',
];

let fixturesRoot: vscode.Uri;

export async function run(): Promise<void> {
  const out = process.env.PROBE_OUT;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!out || !folder) {
    throw new Error('PROBE_OUT must be set and the fixtures workspace must be open');
  }
  fixturesRoot = vscode.Uri.joinPath(folder.uri, '..');

  const report: Record<string, unknown> = {
    vscodeVersion: vscode.version,
    extensions: [
      'vscode.typescript-language-features',
      'ms-python.python',
      'ms-python.vscode-pylance',
    ].map((id) => ({
      id,
      version: vscode.extensions.getExtension(id)?.packageJSON?.version ?? null,
    })),
  };

  // Each step is logged and its error recorded, so one failing command can't
  // hide the results of the others. The report is written even on failure.
  const step = async (label: string, fn: () => Promise<unknown>): Promise<unknown> => {
    console.log(`[probe] ${label}`);
    try {
      return await fn();
    } catch (error) {
      console.log(`[probe] ${label} FAILED: ${String(error)}`);
      return { error: String(error) };
    }
  };

  try {
    const warmup: Record<string, unknown> = {};
    report.warmup = warmup;
    // Each language is warmed up on a function known to make calls, so an empty
    // answer can only mean the language server isn't ready yet.
    for (const symbol of ['placeOrder', 'buildReport', 'place_order']) {
      const target = targets.find((t) => t.symbol === symbol);
      if (target) {
        warmup[target.language] = await step(`warm up ${target.language}`, () => warmUp(target));
      }
    }

    const symbols: Record<string, unknown> = {};
    report.symbols = symbols;
    for (const file of symbolFiles) {
      symbols[file] = await step(`document symbols ${file}`, async () => {
        const result = await vscode.commands.executeCommand<unknown[]>(
          'vscode.executeDocumentSymbolProvider',
          fileUri(file),
        );
        return (result ?? []).map(describeSymbol);
      });
    }

    const codeLenses: Record<string, unknown> = {};
    report.codeLenses = codeLenses;
    for (const file of symbolFiles) {
      codeLenses[file] = await step(`code lenses ${file}`, async () => {
        // This command only works on documents VS Code has loaded.
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(fileUri(file)),
        );
        const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
          'vscode.executeCodeLensProvider',
          fileUri(file),
        );
        return (lenses ?? [])
          .filter((lens) => lens.command?.command === 'prophasis.showFlow')
          .map((lens) => `line ${lens.range.start.line + 1}: ${lens.command?.title}`);
      });
    }

    const results: unknown[] = [];
    report.targets = results;
    for (const target of targets) {
      results.push(
        await step(`target ${target.language} ${target.symbol}`, () => probeTarget(target)),
      );
    }

    report.panel = await step('panel', probePanel);
    report.themeVariables = await step('theme variables', probeThemeVariables);
  } finally {
    writeFileSync(out, JSON.stringify(report, null, 2));
  }
}

function fileUri(file: string): vscode.Uri {
  return vscode.Uri.joinPath(fixturesRoot, file);
}

function rel(uri: vscode.Uri): string {
  const root = fixturesRoot.toString();
  const text = uri.toString();
  return text.startsWith(root)
    ? text.slice(root.length + 1)
    : `EXTERNAL ${uri.scheme}:${uri.path.split('/').slice(-3).join('/')}`;
}

async function findPosition(target: Target): Promise<vscode.Position | undefined> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    fileUri(target.file),
  );
  const stack = [...(symbols ?? [])];
  for (let s = stack.shift(); s; s = stack.shift()) {
    if (s.name === target.symbol) {
      return s.selectionRange.start;
    }
    stack.push(...(s.children ?? []));
  }
  return undefined;
}

/**
 * Opens the first file for a language and asks for its call hierarchy until it
 * answers, recording what an "empty while starting" answer looks like.
 */
async function warmUp(target: Target): Promise<unknown> {
  const started = Date.now();
  const document = await vscode.workspace.openTextDocument(fileUri(target.file));
  await vscode.window.showTextDocument(document);
  const attempts: string[] = [];
  while (Date.now() - started < 90_000) {
    try {
      const position = await findPosition(target);
      if (!position) {
        attempts.push(`${Date.now() - started} ms: symbol not found in document symbols`);
      } else {
        const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[] | undefined>(
          'vscode.prepareCallHierarchy',
          document.uri,
          position,
        );
        attempts.push(
          `${Date.now() - started} ms: prepareCallHierarchy -> ${describeValue(items)}`,
        );
        if (items && items.length > 0) {
          const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
            'vscode.provideOutgoingCalls',
            items[0],
          );
          attempts.push(
            `${Date.now() - started} ms: provideOutgoingCalls -> ${describeValue(outgoing)}`,
          );
          if (outgoing && outgoing.length > 0) {
            return { readyAfterMs: Date.now() - started, attempts };
          }
        }
      }
    } catch (error) {
      attempts.push(`${Date.now() - started} ms: error ${String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { readyAfterMs: null, attempts };
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

function describeSymbol(item: unknown): unknown {
  const s = item as vscode.DocumentSymbol & Partial<vscode.SymbolInformation>;
  return {
    name: s.name,
    kind: vscode.SymbolKind[s.kind],
    detail: s.detail || undefined,
    line: (s.selectionRange ?? s.location?.range)?.start.line + 1,
    children: s.children?.length ? s.children.map(describeSymbol) : undefined,
  };
}

function describeItem(item: vscode.CallHierarchyItem | vscode.TypeHierarchyItem): string {
  return `${vscode.SymbolKind[item.kind]} ${item.name}${item.detail ? ` [${item.detail}]` : ''} @ ${rel(item.uri)}:${item.selectionRange.start.line + 1}`;
}

async function timed<T>(fn: () => Thenable<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - started, value };
  } catch (error) {
    return { ms: Date.now() - started, error: String(error) };
  }
}

async function probeTarget(target: Target): Promise<unknown> {
  const uri = fileUri(target.file);
  const position = await findPosition(target);
  const result: Record<string, unknown> = { ...target };
  if (!position) {
    result.error = 'symbol not found in document symbols';
    return result;
  }
  result.position = `${position.line + 1}:${position.character + 1}`;

  const prepared = await timed(() =>
    vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
      'vscode.prepareCallHierarchy',
      uri,
      position,
    ),
  );
  result.prepareCallHierarchy = {
    ms: prepared.ms,
    error: prepared.error,
    items: prepared.value?.map(describeItem),
  };

  const item = prepared.value?.[0];
  if (item) {
    const outgoing = await timed(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
        'vscode.provideOutgoingCalls',
        item,
      ),
    );
    result.outgoingCalls = {
      ms: outgoing.ms,
      error: outgoing.error,
      calls: outgoing.value?.map((call) => ({
        to: describeItem(call.to),
        callLines: call.fromRanges.map((r) => `${r.start.line + 1}:${r.start.character + 1}`),
      })),
    };
    const incoming = await timed(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
        'vscode.provideIncomingCalls',
        item,
      ),
    );
    result.incomingCalls = {
      ms: incoming.ms,
      error: incoming.error,
      calls: incoming.value?.map((call) => ({
        from: describeItem(call.from),
        callLines: call.fromRanges.map((r) => `${r.start.line + 1}:${r.start.character + 1}`),
      })),
    };
  }

  const references = await timed(() =>
    vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      uri,
      position,
    ),
  );
  result.references = {
    ms: references.ms,
    error: references.error,
    locations: references.value?.map((l) => `${rel(l.uri)}:${l.range.start.line + 1}`),
  };

  if (target.types) {
    const implementations = await timed(() =>
      vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeImplementationProvider',
        uri,
        position,
      ),
    );
    result.implementations = {
      ms: implementations.ms,
      error: implementations.error,
      locations: implementations.value?.map((l) =>
        'targetUri' in l
          ? `${rel(l.targetUri)}:${l.targetRange.start.line + 1}`
          : `${rel(l.uri)}:${l.range.start.line + 1}`,
      ),
    };

    const typePrepared = await timed(() =>
      vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
        'vscode.prepareTypeHierarchy',
        uri,
        position,
      ),
    );
    result.prepareTypeHierarchy = {
      ms: typePrepared.ms,
      error: typePrepared.error,
      items: typePrepared.value?.map(describeItem),
    };
    const typeItem = typePrepared.value?.[0];
    if (typeItem) {
      const supertypes = await timed(() =>
        vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
          'vscode.provideSupertypes',
          typeItem,
        ),
      );
      result.supertypes = {
        ms: supertypes.ms,
        error: supertypes.error,
        items: supertypes.value?.map(describeItem),
      };
      const subtypes = await timed(() =>
        vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
          'vscode.provideSubtypes',
          typeItem,
        ),
      );
      result.subtypes = {
        ms: subtypes.ms,
        error: subtypes.error,
        items: subtypes.value?.map(describeItem),
      };
    }
  }

  return result;
}

/** Runs the real "Show flow" command the way the CodeLens does, then checks a panel opened. */
async function probePanel(): Promise<unknown> {
  const target = targets[0];
  const position = target && (await findPosition(target));
  if (!target || !position) return { error: 'symbol not found' };
  const before = countWebviewTabs();
  await vscode.commands.executeCommand(
    'prophasis.showFlow',
    fileUri(target.file).toString(),
    position.line,
    position.character,
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return {
    webviewTabsBefore: before,
    webviewTabsAfter: countWebviewTabs(),
    labels: vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputWebview)
      .map((t) => t.label),
  };
}

function countWebviewTabs(): number {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputWebview).length;
}

/**
 * Opens a throwaway webview whose script reports which --vscode-symbolIcon-*
 * variables VS Code really defines. The host can't read CSS, so the webview must.
 */
async function probeThemeVariables(): Promise<unknown> {
  const panel = vscode.window.createWebviewPanel(
    'prophasis.probe',
    'Probe',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    },
  );
  const wanted = JSON.stringify(symbolIconNames.map((n) => `--vscode-symbolIcon-${n}Foreground`));
  const answer = new Promise<unknown>((resolve) => {
    panel.webview.onDidReceiveMessage(resolve);
    setTimeout(() => resolve({ error: 'webview did not answer within 15 s' }), 15_000);
  });
  panel.webview.html = `<!DOCTYPE html><html><body><script>
    const vscode = acquireVsCodeApi();
    setTimeout(() => {
      const style = getComputedStyle(document.documentElement);
      const all = [];
      for (const name of document.documentElement.style) {
        if (name.startsWith('--vscode-symbolIcon-')) all.push(name);
      }
      const wanted = ${wanted};
      vscode.postMessage({
        wanted: Object.fromEntries(wanted.map((n) => [n, style.getPropertyValue(n).trim() || null])),
        allSymbolIconVariables: all.sort(),
      });
    }, 500);
  </script></body></html>`;
  const result = await answer;
  panel.dispose();
  return result;
}
