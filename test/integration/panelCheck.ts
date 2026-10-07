/**
 * Opens the real panel in VS Code, drives a few expansions, and takes
 * screenshots in dark, light and high-contrast themes. Fails if the panel app
 * doesn't start (for example, blocked by the security policy). Started by
 * `npm run check:panel`.
 *
 * Privacy: only the window titled "Extension Development Host" is captured,
 * through PrintWindow, so other windows on the screen never appear.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ProphasisTestApi } from '../../src/extension/extension';
import type { Relation } from '../../src/shared/types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(): Promise<void> {
  const out = process.env.PROBE_OUT;
  const shots = process.env.SCREENSHOT_DIR;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!out || !shots || !folder) {
    throw new Error('PROBE_OUT, SCREENSHOT_DIR and the fixtures workspace are needed');
  }
  mkdirSync(shots, { recursive: true });
  const fixtures = vscode.Uri.joinPath(folder.uri, '..');
  const extension = vscode.extensions.getExtension<ProphasisTestApi>('prophasis.prophasis');
  const api = await extension?.activate();
  if (!api) {
    throw new Error('Prophasis did not activate');
  }
  const { panels } = api;
  const log: string[] = [];
  const failures: string[] = [];
  // Written as it goes, so a crash still shows how far it got.
  const save = (stage: string) =>
    writeFileSync(
      out,
      JSON.stringify({ vscodeVersion: vscode.version, stage, failures, log }, null, 2),
    );
  save('started');

  const config = vscode.workspace.getConfiguration('workbench');
  const setTheme = async (theme: string) => {
    await config.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
    await sleep(1500);
  };

  /** Runs "Show flow" the way the CodeLens does, waiting for the language server if needed. */
  const showFlow = async (file: string, line: number, character: number) => {
    const uri = vscode.Uri.joinPath(fixtures, file);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), {
      viewColumn: vscode.ViewColumn.One,
    });
    const started = Date.now();
    for (;;) {
      await vscode.commands.executeCommand('prophasis.showFlow', uri.toString(), line, character);
      const graph = panels.graph();
      const root = graph?.nodes.find((n) => n.id === graph.rootId);
      // Ready once the start has something around it: other cards, or class members.
      const ready = graph && (graph.nodes.length > 1 || (root?.members?.length ?? 0) > 0);
      if (ready || Date.now() - started > 60_000) {
        return graph;
      }
      await sleep(1000);
    }
  };

  const expand = async (name: string, relation: Relation) => {
    const graph = panels.graph();
    const target =
      graph?.nodes.find((n) => n.name === name) ??
      graph?.nodes.flatMap((n) => n.members ?? []).find((m) => m.name === name);
    if (!target) {
      failures.push(`could not find ${name} to expand`);
      return;
    }
    panels.receive({ type: 'expand', nodeId: target.id, relation });
    await panels.idle();
  };

  const capture = async (name: string) => {
    await sleep(1500); // let the panel lay out and fit
    const result = await captureForeground(join(shots, `${name}.png`));
    log.push(`${name}: ${result}`);
    save(name);
    console.log(`[panel] ${name}: ${result}`);
  };

  await setTheme('Default Dark Modern');

  // 1. A method, its calls, its callers, and one level further.
  await showFlow('ts/src/orders/orderService.ts', 11, 8);
  for (let i = 0; i < 20 && !panels.appStarted; i++) {
    await sleep(500);
  }
  if (!panels.appStarted) {
    failures.push('the panel app never started (script blocked or crashed)');
  }
  await expand('placeOrder', 'calledBy');
  await expand('chargePayment', 'calls');
  await capture('1-dark-method');

  // Collapse: clicking a used button hides what it showed.
  const before = panels.graph();
  const chargePayment = before?.nodes.find((n) => n.name === 'chargePayment');
  if (chargePayment) {
    panels.receive({ type: 'collapse', nodeId: chargePayment.id, relation: 'calls' });
    await panels.idle();
    const after = panels.graph();
    const gone = !after?.nodes.some((n) => n.name === 'charge');
    const kept = after?.nodes.some((n) => n.name === 'main');
    log.push(`collapse chargePayment calls: charge removed=${gone}, main kept=${kept}`);
    if (!gone || !kept) {
      failures.push('collapse: expected charge removed and main kept');
    }
  }

  // 2. A class card: arrows leave from member rows, including a loop to a row of the same card.
  await showFlow('ts/src/orders/orderService.ts', 6, 14);
  await expand('placeOrder', 'calls');
  await expand('OrderService', 'calledBy');
  const classGraph = panels.graph();
  const fromRow = classGraph?.edges.some((e) =>
    e.fromId.includes('#method:OrderService.placeOrder'),
  );
  if (!fromRow) {
    failures.push('class card: expected arrows from the placeOrder row');
  }
  await capture('2-dark-class');
  await setTheme('Default Light Modern');
  await capture('3-light-class');
  await setTheme('Default High Contrast');
  await capture('4-high-contrast-class');
  await setTheme('Default Dark Modern');

  // 3. Python, and a recursive function.
  await showFlow('py/shop/orders/order_service.py', 14, 9);
  await capture('5-dark-python');
  await showFlow('ts/src/notify/email.ts', 11, 17);
  await expand('isOdd', 'calls');
  await capture('6-dark-recursion');

  // 4. Click-to-jump: revealing a card opens its file with the name selected.
  const charge = (await showFlow('ts/src/orders/orderService.ts', 26, 12))?.nodes.find(
    (n) => n.name === 'charge',
  );
  if (charge) {
    panels.receive({ type: 'reveal', nodeId: charge.id });
    await sleep(1000);
    const editor = vscode.window.activeTextEditor;
    const at = editor?.selection.start;
    const shown = `${vscode.workspace.asRelativePath(editor?.document.uri ?? '')}:${(at?.line ?? -1) + 1}`;
    log.push(`reveal charge -> ${shown} "${editor?.document.getText(editor.selection)}"`);
    if (
      shown !== 'ts/src/payments/gateway.ts:2' ||
      editor?.document.getText(editor.selection) !== 'charge'
    ) {
      failures.push(`reveal: expected ts/src/payments/gateway.ts:2 "charge", got ${shown}`);
    }
  } else {
    failures.push('reveal: no charge card');
  }

  // 5. A function with no calls shows the "No calls found" message.
  await vscode.commands.executeCommand(
    'prophasis.showFlow',
    vscode.Uri.joinPath(fixtures, 'js/src/shapes.js').toString(),
    26,
    14,
  );
  await capture('7-dark-empty');

  // 6. Used by and Extends on an interface (Phase 4).
  await showFlow('ts/src/payments/gateway.ts', 0, 18);
  await expand('PaymentProvider', 'usedBy');
  await expand('PaymentProvider', 'extends');
  const typed = panels.graph();
  const kinds = new Set(typed?.edges.map((e) => e.kind));
  log.push(`interface edges: ${[...kinds].join(', ')}`);
  if (!kinds.has('usedBy') || !kinds.has('implements')) {
    failures.push('interface: expected usedBy and implements arrows');
  }
  await capture('8-dark-uses-and-types');

  // Explain, end to end. The test copy of VS Code isn't signed in to Copilot,
  // so the expected answer is the clear "no language model" message.
  const provider = panels.graph()?.rootId;
  if (provider) {
    panels.receive({ type: 'explain', nodeId: provider });
    await sleep(2500);
    await capture('9-dark-explain-no-model');
  }

  // 7. Back returns to the previous starting point with its graph as it was.
  panels.receive({ type: 'back' });
  await sleep(800);
  const backRoot = panels.graph()?.nodes.find((n) => n.id === panels.graph()?.rootId)?.name;
  panels.receive({ type: 'forward' });
  await sleep(800);
  const forwardRoot = panels.graph()?.nodes.find((n) => n.id === panels.graph()?.rootId)?.name;
  log.push(`back -> ${backRoot}, forward -> ${forwardRoot}`);
  if (backRoot !== 'format' || forwardRoot !== 'PaymentProvider') {
    failures.push(`history: expected back to format and forward to PaymentProvider`);
  }

  save('done');
  if (failures.length > 0) {
    throw new Error(`Panel check failed:\n  ${failures.join('\n  ')}`);
  }
}

/**
 * Saves a PNG of the Extension Development Host window, found by its title.
 * PrintWindow copies that one window's contents even when other windows
 * cover it, so nothing else on the screen is captured.
 */
function captureForeground(file: string): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.resolve('skipped (screenshots are only set up for Windows)');
  }
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int Left, Top, Right, Bottom; }
  // The largest visible window with the title: VS Code also has small helper windows.
  public static IntPtr Find(string part) {
    IntPtr found = IntPtr.Zero; long best = 0;
    EnumWindows((h, p) => {
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      RECT r;
      if (IsWindowVisible(h) && sb.ToString().Contains(part) && GetWindowRect(h, out r)) {
        long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
        if (area > best) { best = area; found = h; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[W]::SetProcessDPIAware() | Out-Null
$h = [W]::Find('Extension Development Host')
if ($h -eq [IntPtr]::Zero) { Write-Output "skipped (test window not found)"; exit 0 }
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
# 2 = PW_RENDERFULLCONTENT, needed for windows drawn by the GPU (Chromium).
$ok = [W]::PrintWindow($h, $dc, 2)
$g.ReleaseHdc($dc)
$bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved ($w x $hgt, PrintWindow=$ok)"
`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
      (error, stdout) => resolve(error ? `failed: ${error.message}` : stdout.trim()),
    );
  });
}
