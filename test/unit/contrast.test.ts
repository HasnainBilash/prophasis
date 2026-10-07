// Checks the kind palette in the real stylesheet against WCAG 2.1 contrast:
// 4.5:1 for text (kind glyphs, badge numbers), 3:1 for lines (arrows).
// Backgrounds are VS Code's default Dark Modern and Light Modern editors.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/webview/styles.css', 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const [, name, value] = match;
    if (name && value) {
      vars[name] = value;
    }
  }
  return vars;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** A colour variable that must exist in the stylesheet. */
function colour(vars: Record<string, string>, name: string): string {
  const value = vars[name];
  if (!value) {
    throw new Error(`${name} is missing from styles.css`);
  }
  return value;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const kinds = [
  'function',
  'method',
  'constructor',
  'class',
  'interface',
  'struct',
  'enum',
  'start',
];
const themes = [
  { name: 'dark', vars: block(':root'), background: '#1f1f1f' },
  {
    name: 'light',
    vars: { ...block(':root'), ...block('body.vscode-light') },
    background: '#ffffff',
  },
];

describe.each(themes)('$name theme palette', ({ vars, background }) => {
  it.each(kinds)('%s colour is readable as text on the editor background', (kind) => {
    expect(contrast(colour(vars, `--k-${kind}`), background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(kinds.filter((k) => k !== 'start'))('badge numbers are readable on %s arrows', (kind) => {
    const badgeText = vars['--badge-text'] ?? (background === '#ffffff' ? '#ffffff' : '#0b1020');
    expect(contrast(colour(vars, `--k-${kind}`), badgeText)).toBeGreaterThanOrEqual(4.5);
  });

  it('plain arrows stand out from the background', () => {
    expect(contrast(colour(vars, '--edge-plain'), background)).toBeGreaterThanOrEqual(3);
  });
});
