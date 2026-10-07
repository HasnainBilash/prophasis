import { execFile } from 'node:child_process';

/** Part of the window to keep, as fractions of its width and height (0 to 1). */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Saves a PNG of the Extension Development Host window, found by its title.
 * PrintWindow copies that one window's contents even when other windows cover
 * it, so nothing else on the screen is ever captured. Windows only.
 */
export function captureTestWindow(file: string, crop?: Crop): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.resolve('skipped (screenshots are only set up for Windows)');
  }
  const c = crop ?? { left: 0, top: 0, right: 1, bottom: 1 };
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
$x = [int]($w * ${c.left}); $y = [int]($hgt * ${c.top})
$cw = [int]($w * ${c.right}) - $x; $ch = [int]($hgt * ${c.bottom}) - $y
$out = $bmp.Clone((New-Object System.Drawing.Rectangle $x, $y, $cw, $ch), $bmp.PixelFormat)
$out.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved ($cw x $ch, PrintWindow=$ok)"
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
