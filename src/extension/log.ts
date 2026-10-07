import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

/** Opens the "Prophasis" log in the Output panel (View → Output → Prophasis). */
export function startLog(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Prophasis', { log: true });
  context.subscriptions.push(channel);
}

type Details = Record<string, string | number | boolean | undefined>;

/**
 * One structured line per problem: an event name, the error and a little
 * context (never code contents). This is the place to plug in monitoring, and
 * what a user can copy into a bug report.
 */
export function logError(event: string, error: unknown, details: Details = {}): void {
  const err =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { message: String(error) };
  channel?.error(JSON.stringify({ event, ...err, ...details }));
}

export function logWarning(event: string, details: Details = {}): void {
  channel?.warn(JSON.stringify({ event, ...details }));
}
