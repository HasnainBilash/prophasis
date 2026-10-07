import type { NodeKind } from '../../shared/types';
import { CLASS_LIKE } from '../../shared/types';

const kindByName: Record<string, NodeKind> = {
  Function: 'function',
  Method: 'method',
  Constructor: 'constructor',
  Class: 'class',
  Interface: 'interface',
  Struct: 'struct',
  Enum: 'enum',
};

/** Maps a language server's SymbolKind name to a card kind, if it can be one. */
export function toNodeKind(symbolKind: string): NodeKind | undefined {
  return kindByName[symbolKind];
}

export function isClassLike(kind: NodeKind): boolean {
  return CLASS_LIKE.includes(kind);
}

/**
 * Variables, constants and class properties can hold a function:
 * `const f = () => …`, or `produce = (base) => …` inside a class.
 */
export function isValueKind(symbolKind: string): boolean {
  return (
    symbolKind === 'Variable' ||
    symbolKind === 'Constant' ||
    symbolKind === 'Property' ||
    symbolKind === 'Field'
  );
}

// Matches what follows a variable's name when its value is a function:
// `= () =>`, `= async (a) =>`, `= x =>`, `= function`, `: Type = (…) =>`,
// a parameter list that continues on the next line, or Python's `= lambda`.
const functionValue =
  /^\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|\([^)]*$|[A-Za-z_$][\w$]*\s*=>|lambda\b)/;

/**
 * Whether a variable holds a function, judged from the text right after its
 * name on the same line. A cheap text check, so the CodeLens stays fast.
 */
export function looksLikeFunctionValue(textAfterName: string): boolean {
  return functionValue.test(textAfterName);
}

/**
 * TypeScript lists inline callbacks as functions named like
 * "items.reduce() callback". A card or button for each of them is noise.
 */
export function isAnonymousCallback(name: string): boolean {
  return name.endsWith(') callback');
}
