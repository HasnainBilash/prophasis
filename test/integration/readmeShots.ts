/**
 * Takes the README images in a real VS Code: animation frames of one
 * exploration (cropped to the panel) and a few stills. Started by
 * `npm run readme:images`, which also turns the frames into docs/images/demo.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ProphasisTestApi } from '../../src/extension/extension';
import type { Relation } from '../../src/shared/types';
import { captureTestWindow, type Crop } from './capture';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// The panel is the right part of the window, below its tab, above the status bar.
const PANEL: Crop = { left: 0.588, top: 0.072, right: 0.995, bottom: 0.962 };

export async function run(): Promise<void> {
  const out = process.env.PROBE_OUT;
  const dir = process.env.README_DIR;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!out || !dir || !folder) {
    throw new Error('PROBE_OUT, README_DIR and the fixtures workspace are needed');
  }
  mkdirSync(join(dir, 'frames'), { recursive: true });
  const fixtures = vscode.Uri.joinPath(folder.uri, '..');
  const api = await vscode.extensions
    .getExtension<ProphasisTestApi>('prophasis.prophasis')
    ?.activate();
  if (!api) {
    throw new Error('Prophasis did not activate');
  }
  const { panels } = api;
  const log: string[] = [];
  const theme = (name: string) =>
    vscode.workspace
      .getConfiguration('workbench')
      .update('colorTheme', name, vscode.ConfigurationTarget.Global);

  const show = async (file: string, line: number, character: number) => {
    const uri = vscode.Uri.joinPath(fixtures, file);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), {
      viewColumn: vscode.ViewColumn.One,
    });
    for (let i = 0; i < 60; i++) {
      await vscode.commands.executeCommand('prophasis.showFlow', uri.toString(), line, character);
      const graph = panels.graph();
      const root = graph?.nodes.find((n) => n.id === graph.rootId);
      if (graph && (graph.nodes.length > 1 || (root?.members?.length ?? 0) > 0)) return;
      await sleep(1000);
    }
  };
  const expand = async (name: string, relation: Relation) => {
    const graph = panels.graph();
    const target =
      graph?.nodes.find((n) => n.name === name) ??
      graph?.nodes.flatMap((n) => n.members ?? []).find((m) => m.name === name);
    if (target) {
      panels.receive({ type: 'expand', nodeId: target.id, relation });
      await panels.idle();
    }
  };
  let frame = 0;
  const snap = async (file: string, crop?: Crop) => {
    await sleep(1800); // layout, fit and enter motion settle
    log.push(`${file}: ${await captureTestWindow(join(dir, file), crop)}`);
  };
  const nextFrame = () => snap(`frames/frame-${String(++frame).padStart(2, '0')}.png`, PANEL);

  // A clean look: the first-open tip off, dark theme.
  panels.receive({ type: 'dismissHint' });
  await theme('Default Dark Modern');

  // The exploration shown in the animation.
  await show('ts/src/orders/orderService.ts', 11, 8);
  await nextFrame();
  await expand('placeOrder', 'calledBy');
  await nextFrame();
  await expand('chargePayment', 'calls');
  await nextFrame();
  await snap('hero.png');
  await show('ts/src/orders/orderService.ts', 6, 14);
  await nextFrame();
  await expand('placeOrder', 'calls');
  await nextFrame();
  await theme('Default Light Modern');
  await snap('class-light.png', PANEL);
  await theme('Default Dark Modern');
  await show('ts/src/payments/gateway.ts', 0, 18);
  await expand('PaymentProvider', 'usedBy');
  await expand('PaymentProvider', 'extends');
  await nextFrame();
  await snap('uses-and-types.png', PANEL);

  writeFileSync(out, JSON.stringify({ log }, null, 2));
}
