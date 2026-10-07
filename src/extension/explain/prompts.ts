import { createHash } from 'node:crypto';

/** One piece of code to explain: a function, a class, or a step of a path. */
export interface CodePiece {
  /** Shown to the model, e.g. "method OrderService.placeOrder (src/orders/orderService.ts, line 12)". */
  label: string;
  /** Language id for the code fence, e.g. "typescript". */
  language: string;
  code: string;
}

export interface Prompt {
  text: string;
  /** Characters of code actually sent, after the cap. */
  codeCharacters: number;
  /** Some code was cut to stay under the cap. */
  truncated: boolean;
  /** Identifies the exact request, so the same code is explained only once. */
  hash: string;
}

const instructions = {
  single: (language: string) =>
    [
      'You explain code to a developer who is new to this codebase.',
      'Explain what the code below does in plain language: its purpose, its inputs and outputs, and any side effects.',
      'Use 3 to 6 short sentences. Do not repeat the code. If something is unclear from the code alone, say so.',
      `Answer in the language with this code: ${language}.`,
    ].join(' '),
  path: (language: string) =>
    [
      'You explain code to a developer who is new to this codebase.',
      'The functions below form a call path, in order: each one calls the next.',
      'Explain step by step how control and data move from the first to the last, in plain language.',
      'Use one short paragraph per step. Do not repeat the code. Arrow order is the order calls are written, not necessarily run.',
      `Answer in the language with this code: ${language}.`,
    ].join(' '),
};

/**
 * Builds the request text. Code is cut to `maxCharacters` in total, sharing
 * the budget between pieces so each step of a path keeps its beginning.
 */
export function buildPrompt(
  pieces: CodePiece[],
  kind: 'single' | 'path',
  maxCharacters: number,
  displayLanguage: string,
): Prompt {
  const total = pieces.reduce((sum, p) => sum + p.code.length, 0);
  const truncated = total > maxCharacters;
  const share = Math.floor(maxCharacters / Math.max(pieces.length, 1));
  let codeCharacters = 0;
  const blocks = pieces.map((piece, index) => {
    const code =
      truncated && piece.code.length > share
        ? `${piece.code.slice(0, share)}\n// … cut to fit`
        : piece.code;
    codeCharacters += Math.min(piece.code.length, truncated ? share : piece.code.length);
    const heading = kind === 'path' ? `Step ${index + 1}: ${piece.label}` : piece.label;
    return `${heading}\n\`\`\`${piece.language}\n${code}\n\`\`\``;
  });
  const text = `${instructions[kind](displayLanguage)}\n\n${blocks.join('\n\n')}`;
  return {
    text,
    codeCharacters,
    truncated,
    hash: createHash('sha256').update(text).digest('hex'),
  };
}
