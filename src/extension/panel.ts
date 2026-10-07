import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export interface PanelStart {
  name: string;
  kind: string;
  /** Workspace-relative path, for display only. */
  path: string;
  /** 1-based line, for display only. */
  line: number;
}

/** Owns the single Prophasis panel. A new start replaces what it shows. */
export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  show(start: PanelStart): void {
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
      });
    } else {
      this.panel.reveal(undefined, true);
    }
    this.panel.title = `Prophasis: ${start.name}`;
    this.panel.webview.html = renderHtml(start);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

function renderHtml(start: PanelStart): string {
  const nonce = randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { margin: 0; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background);
         font: 13px/1.4 var(--vscode-font-family); }
  .card { display: inline-block; min-width: 240px; padding: 8px 12px 8px 14px; border-radius: 6px;
          border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder, transparent));
          border-left: 4px solid var(--vscode-focusBorder); background: var(--vscode-sideBar-background); }
  .kind { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
  .name { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  .path, .note { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .note { margin-top: 16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="kind">${escapeHtml(start.kind)}</div>
    <div class="name">${escapeHtml(start.name)}</div>
    <div class="path">${escapeHtml(start.path)} · line ${start.line}</div>
  </div>
  <p class="note">Start card only. Cards and arrows arrive in a later phase.</p>
</body>
</html>`;
}

// Names come from the user's code, so they are always escaped, never trusted as HTML.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
