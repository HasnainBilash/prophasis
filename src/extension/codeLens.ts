import * as vscode from 'vscode';
import { getStartSymbols } from './symbols';

export const SHOW_FLOW = 'prophasis.showFlow';

// While a language server starts, VS Code won't ask for CodeLenses again by
// itself, so an empty answer is followed by a few timed refreshes.
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 15;

/**
 * Puts a "Show flow" button above every function, method and class. It only
 * reads document symbols; the call hierarchy is not touched until a click.
 */
export class FlowCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly retries = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const symbols = await getStartSymbols(document);
    const key = `${document.uri.toString()}@${document.version}`;
    if (symbols.length === 0) {
      this.retryLater(key);
    } else {
      this.retries.delete(key);
    }
    return symbols.map(
      (symbol) =>
        new vscode.CodeLens(symbol.selectionRange, {
          title: 'Show flow',
          tooltip: `Show how ${symbol.name} connects to the rest of the code`,
          command: SHOW_FLOW,
          arguments: [
            document.uri.toString(),
            symbol.selectionRange.start.line,
            symbol.selectionRange.start.character,
          ],
        }),
    );
  }

  private retryLater(key: string): void {
    const count = this.retries.get(key) ?? 0;
    if (count >= MAX_RETRIES || this.timer) {
      return;
    }
    this.retries.set(key, count + 1);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.changed.fire();
    }, RETRY_DELAY_MS);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.changed.dispose();
  }
}
