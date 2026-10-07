import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { FlowGraph, FlowNode, GraphStatus } from '../shared/types';

export interface PanelContent {
  title: string;
  status: GraphStatus | 'error';
  /** Shown for status "error". */
  message?: string;
  graph?: FlowGraph;
}

/** Owns the single Prophasis panel. A new start replaces what it shows. */
export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly closed = new vscode.EventEmitter<void>();
  /** Fires when the user closes the panel, so running requests can be cancelled. */
  readonly onDidClose = this.closed.event;

  show(content: PanelContent): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'prophasis.graph',
        'Prophasis',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        // No scripts yet and no local files: the panel has nothing to load.
        { enableScripts: false, localResourceRoots: [] },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.closed.fire();
      });
    } else {
      this.panel.reveal(undefined, true);
    }
    this.panel.title = `Prophasis: ${content.title}`;
    this.panel.webview.html = renderHtml(content);
  }

  dispose(): void {
    this.panel?.dispose();
    this.closed.dispose();
  }
}

const statusText: Record<Exclude<GraphStatus, 'ok'>, string> = {
  empty:
    'No calls found for this function. It may only use library code (hidden by default), or call things the language server can’t see, such as callbacks or dynamic calls.',
  languageServerStarting:
    'The language server is still starting. Click “Show flow” again in a few seconds.',
  unsupported:
    'This language’s extension doesn’t provide call information. Try TypeScript, JavaScript or Python.',
  noSymbol: 'No function, method or class found here.',
};

// A temporary text view of the graph engine's output (Phase 2), so results can
// be checked by hand. Phase 3 replaces it with cards and arrows.
function renderHtml(content: PanelContent): string {
  const nonce = randomBytes(16).toString('base64');
  const graph = content.graph;
  const root = graph?.nodes.find((n) => n.id === graph.rootId);
  const parts: string[] = [];

  if (content.status === 'error') {
    parts.push(`<p class="notice">${esc(content.message ?? 'Something went wrong.')}</p>`);
  } else if (content.status !== 'ok') {
    parts.push(`<p class="notice">${esc(statusText[content.status])}</p>`);
  }

  if (graph && root) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    parts.push(card(root, 'start'));

    if (root.members) {
      const rows = root.members
        .map(
          (m) =>
            `<li><span class="k">${esc(m.kind)}</span> ${esc(m.name)} <span class="muted">line ${m.line}</span></li>`,
        )
        .join('');
      const more = root.hiddenMembers
        ? `<li class="muted">+ ${root.hiddenMembers} more members</li>`
        : '';
      parts.push(`<h2>Contains</h2><ul>${rows}${more}</ul>`);
    }

    const calls = graph.edges
      .filter((e) => e.fromId === root.id && e.kind === 'calls')
      .sort((a, b) => a.order - b.order);
    if (!root.members) {
      parts.push(
        '<h2>Calls <span class="muted">(numbered in the order they appear in the code)</span></h2>',
      );
      parts.push(
        calls.length
          ? `<ol>${calls.map((e) => `<li>${link(byId.get(e.toId))} <span class="muted">called on line ${e.callLines.join(', ')}</span></li>`).join('')}</ol>`
          : '<p class="muted">None found.</p>',
      );
    }

    const callers = graph.edges.filter(
      (e) => e.toId === root.id && (e.kind === 'calls' || e.kind === 'calledBy'),
    );
    parts.push('<h2>Called by</h2>');
    parts.push(
      callers.length
        ? `<ul>${callers.map((e) => `<li>${link(byId.get(e.fromId))} <span class="muted">calls it on line ${e.callLines.join(', ')}</span></li>`).join('')}</ul>`
        : '<p class="muted">No callers found.</p>',
    );

    const notes: string[] = [];
    if (root.isRecursive) {
      notes.push('This function calls itself, directly or through other functions (recursion).');
    }
    if (graph.hiddenCount > 0) {
      notes.push(`${graph.hiddenCount} more not shown (card limit).`);
    }
    if (notes.length) {
      parts.push(`<p class="muted">${notes.map(esc).join(' ')}</p>`);
    }
  }

  parts.push(
    '<p class="note">Text preview of the graph engine. Cards and arrows arrive in the next phase.</p>',
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { margin: 0; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background);
         font: 13px/1.5 var(--vscode-font-family); }
  .card { display: inline-block; min-width: 240px; padding: 8px 12px 8px 14px; border-radius: 8px;
          border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder, transparent));
          border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-sideBar-background); }
  .kind, .k { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
  .name { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .sig { font-family: var(--vscode-editor-font-family); font-size: 12px; color: var(--vscode-descriptionForeground); }
  h2 { font-size: 13px; margin: 20px 0 6px; }
  ol, ul { margin: 0; padding-left: 22px; }
  li { margin: 3px 0; }
  .muted, .path, .note { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .note { margin-top: 24px; }
  .notice { padding: 8px 12px; border-radius: 6px; background: var(--vscode-inputValidation-infoBackground, transparent);
            border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder)); }
  code { font-family: var(--vscode-editor-font-family); }
</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
}

function card(node: FlowNode, label: string): string {
  return `<div class="card">
    <div class="kind">${esc(label)} · ${esc(node.kind)}</div>
    <div class="name">${esc(node.name)}</div>
    <div class="path">${esc(node.filePath)} · line ${node.line}</div>
    <div class="sig">${esc(node.signature)}</div>
  </div>`;
}

function link(node: FlowNode | undefined): string {
  if (!node) {
    return '<span class="muted">(unknown)</span>';
  }
  const marks = node.isRecursive ? ' ↻' : '';
  return `<code>${esc(node.name)}</code>${marks} <span class="muted">${esc(node.kind)} · ${esc(node.filePath)}:${node.line}</span>`;
}

// Names come from the user's code, so they are always escaped, never trusted as HTML.
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
