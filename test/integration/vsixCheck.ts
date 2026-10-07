/**
 * Checks the packaged extension: the .vsix is installed into a clean test copy
 * of VS Code (not loaded from the source folder), then used like a user would.
 * Catches packaging mistakes such as a missing bundle or a wrong path.
 * Started by `npm run check:vsix`.
 */
import { writeFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { ProphasisTestApi } from '../../src/extension/extension';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(): Promise<void> {
  const out = process.env.PROBE_OUT;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!out || !folder) {
    throw new Error('PROBE_OUT and the fixtures workspace are needed');
  }
  const failures: string[] = [];
  const extension = vscode.extensions.getExtension<ProphasisTestApi>('prophasis.prophasis');
  if (!extension) {
    throw new Error('the installed Prophasis extension was not found');
  }
  const installedFrom = extension.extensionPath;
  const api = await extension.activate();

  const uri = vscode.Uri.joinPath(folder.uri, '..', 'ts/src/orders/orderService.ts');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  const started = Date.now();
  let cards = 0;
  while (Date.now() - started < 90_000) {
    await vscode.commands.executeCommand('prophasis.showFlow', uri.toString(), 11, 8);
    cards = api.panels.graph()?.nodes.length ?? 0;
    if (cards > 1) break;
    await sleep(1000);
  }
  for (let i = 0; i < 20 && !api.panels.appStarted; i++) await sleep(500);

  if (cards < 6) failures.push(`expected placeOrder and its 5 callees, got ${cards} cards`);
  if (!api.panels.appStarted) failures.push('the panel app did not start from the packaged files');
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['prophasis.showFlow', 'prophasis.copyMermaid']) {
    if (!commands.includes(id)) failures.push(`command ${id} is missing`);
  }

  writeFileSync(
    out,
    JSON.stringify(
      { installedFrom, version: extension.packageJSON.version, cards, failures },
      null,
      2,
    ),
  );
  if (failures.length)
    throw new Error(`Packaged extension check failed:\n  ${failures.join('\n  ')}`);
  console.log(`[vsix] installed from ${installedFrom}: ${cards} cards, panel started`);
}
