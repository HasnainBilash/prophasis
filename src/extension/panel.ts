import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { GraphBuilder } from './engine/builder';
import { CancelledError, QueryTimeoutError } from './engine/queries';
import { toHost, type ToHost, type ToPanel } from '../shared/messages';
import type { GraphStatus } from '../shared/types';

/** Remembers (per user, across sessions) that the first-open hint was closed. */
const HINT_SEEN = 'prophasis.hintSeen';

/** What the panel currently shows: one starting point and the graph grown from it. */
export interface Session {
  title: string;
  status: GraphStatus | 'error';
  /** Shown for status "error". */
  message?: string;
  /** Absent when there is no graph (for example "language server starting"). */
  builder?: GraphBuilder;
  /** The editor column the user started from; click-to-jump opens files there. */
  sourceColumn?: vscode.ViewColumn;
}

/** Owns the single Prophasis panel. A new start replaces what it shows. */
export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private session: Session | undefined;
  // Expansions run one at a time, so two clicks can't change the graph at once.
  private queue: Promise<void> = Promise.resolve();
  private readyCount = 0;
  private readonly closed = new vscode.EventEmitter<void>();
  private readonly retried = new vscode.EventEmitter<void>();
  /** Fires when the user closes the panel, so running requests can be cancelled. */
  readonly onDidClose = this.closed.event;
  /** Fires when the user clicks Retry. */
  readonly onDidRequestRetry = this.retried.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly memory: vscode.Memento,
  ) {}

  show(session: Session): void {
    this.session = session;
    this.queue = Promise.resolve();
    if (!this.panel) {
      this.panel = this.createPanel();
    } else {
      this.panel.reveal(undefined, true);
      this.sendInit();
    }
    this.panel.title = `Prophasis: ${session.title}`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.closed.dispose();
    this.retried.dispose();
  }

  private createPanel(): vscode.WebviewPanel {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel(
      'prophasis.graph',
      'Prophasis',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      // Only our own bundle can be loaded. The app asks for the graph again
      // ("ready") whenever the panel is shown, so it needn't stay in memory.
      { enableScripts: true, localResourceRoots: [dist] },
    );
    panel.webview.html = renderHtml(panel.webview, dist);
    panel.webview.onDidReceiveMessage((raw: unknown) => this.receive(raw));
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.session = undefined;
      this.closed.fire();
    });
    return panel;
  }

  /** True once the panel app has started and asked for the graph (it ran under the security policy). */
  get appStarted(): boolean {
    return this.readyCount > 0;
  }

  /** Handles a message as if it came from the panel. Also used by the integration tests. */
  receive(raw: unknown): void {
    const parsed = toHost.safeParse(raw);
    if (!parsed.success) {
      console.warn('Prophasis: ignored an unexpected message from the panel');
      return;
    }
    const message: ToHost = parsed.data;
    switch (message.type) {
      case 'ready':
        this.readyCount++;
        this.sendInit();
        break;
      case 'retry':
        this.retried.fire();
        break;
      case 'reveal':
        void this.reveal(message.nodeId);
        break;
      case 'expand': {
        const session = this.session;
        this.queue = this.queue.then(() => this.expand(session, message.nodeId, message.relation));
        break;
      }
      case 'collapse': {
        const session = this.session;
        this.queue = this.queue.then(() => {
          if (session?.builder && session === this.session) {
            this.post({
              type: 'graph:patch',
              patch: session.builder.collapse(message.nodeId, message.relation),
            });
          }
        });
        break;
      }
      case 'dismissHint':
        void this.memory.update(HINT_SEEN, true);
        break;
    }
  }

  private sendInit(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    this.post({
      type: 'graph:init',
      status: session.status,
      message: session.message,
      graph: session.builder?.snapshot(),
      showHint: session.builder !== undefined && !this.memory.get<boolean>(HINT_SEEN, false),
    });
  }

  /** Resolves when every expansion asked for so far has finished. */
  idle(): Promise<void> {
    return this.queue;
  }

  /** The graph the panel currently shows. */
  graph() {
    return this.session?.builder?.snapshot();
  }

  private async expand(
    session: Session | undefined,
    nodeId: string,
    relation: Extract<ToHost, { type: 'expand' }>['relation'],
  ): Promise<void> {
    // The session may have been replaced while this request waited its turn.
    if (!session?.builder || session !== this.session) {
      return;
    }
    try {
      const patch = await session.builder.expand(nodeId, relation);
      if (session === this.session) {
        this.post({ type: 'graph:patch', patch });
        this.post({ type: 'expand:done', nodeId, relation });
      }
    } catch (error) {
      if (error instanceof CancelledError || session !== this.session) {
        return;
      }
      const text =
        error instanceof QueryTimeoutError
          ? 'The language server took too long to answer. Try again in a moment.'
          : `Could not load this: ${String(error)}`;
      this.post({ type: 'expand:done', nodeId, relation, error: text });
    }
  }

  /** Click-to-jump: opens the file and selects the symbol's name. */
  private async reveal(nodeId: string): Promise<void> {
    const location = this.session?.builder?.locationOf(nodeId);
    if (!location) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(location.uri, true));
    const at = new vscode.Position(location.pos.line, location.pos.character);
    const range = document.getWordRangeAtPosition(at) ?? new vscode.Range(at, at);
    await vscode.window.showTextDocument(document, {
      viewColumn: this.session?.sourceColumn ?? vscode.ViewColumn.One,
      selection: range,
    });
  }

  private post(message: ToPanel): void {
    void this.panel?.webview.postMessage(message);
  }
}

function renderHtml(webview: vscode.Webview, dist: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
  // Only our bundle runs: no inline scripts, no remote resources. Styles come
  // from our stylesheet; React sets element styles through the DOM, which the
  // policy allows.
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style.toString()}">
<title>Prophasis</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
}
