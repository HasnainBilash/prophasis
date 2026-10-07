import * as vscode from 'vscode';
import { FlowCodeLensProvider, SHOW_FLOW } from './codeLens';
import { PanelManager } from './panel';
import { forgetDocument, getStartSymbols, symbolAt } from './symbols';

// Activation only registers things. Nothing scans the workspace.
export function activate(context: vscode.ExtensionContext): void {
  const panels = new PanelManager();
  const codeLenses = new FlowCodeLensProvider();

  context.subscriptions.push(
    panels,
    codeLenses,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLenses),
    vscode.commands.registerCommand(SHOW_FLOW, (...args: unknown[]) => showFlow(panels, args)),
    vscode.workspace.onDidCloseTextDocument((document) => forgetDocument(document.uri)),
  );
}

export function deactivate(): void {}

/**
 * Called from the CodeLens with (uri, line, character),
 * or from the command palette with no arguments (then the cursor is used).
 */
async function showFlow(panels: PanelManager, args: unknown[]): Promise<void> {
  const target = readTarget(args);
  if (!target) {
    void vscode.window.showInformationMessage(
      'Prophasis: put the cursor inside a function, method or class, then run "Show Flow".',
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument(target.uri);
  const symbol = symbolAt(await getStartSymbols(document), target.position);
  if (!symbol) {
    void vscode.window.showInformationMessage(
      'Prophasis: no function, method or class found here. If the file just opened, the language server may still be starting. Try again in a few seconds.',
    );
    return;
  }

  panels.show({
    name: symbol.name,
    kind: vscode.SymbolKind[symbol.kind].toLowerCase(),
    path: vscode.workspace.asRelativePath(document.uri),
    line: symbol.selectionRange.start.line + 1,
  });
}

function readTarget(args: unknown[]): { uri: vscode.Uri; position: vscode.Position } | undefined {
  const [first, second, third] = args;
  if (typeof first === 'string') {
    const uri = vscode.Uri.parse(first, true);
    if (typeof second === 'number' && typeof third === 'number') {
      return { uri, position: new vscode.Position(second, third) };
    }
    return undefined;
  }
  const editor = vscode.window.activeTextEditor;
  return editor ? { uri: editor.document.uri, position: editor.selection.active } : undefined;
}
