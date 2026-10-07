/** Longest doc comment shown on a card. */
export const MAX_DOC = 160;

/**
 * The first paragraph of a doc comment, taken from hover text. Language
 * servers put the signature in code blocks and the doc comment as plain
 * Markdown around it; tags like `@param` and Python's "Args:" sections are
 * left out, since a card only has room for the summary.
 */
export function docFromHover(markdown: string): string {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, '\n\n')
    // Pylance adds hidden markers such as <!--moduleHash:123-->; HTML never belongs on a card.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '');
  const paragraphs = withoutCode
    .split(/\n\s*\n|\n?---+\n?/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^[@*_]*(@param|@returns?|Args:|Returns:|Raises:)/i.test(p));
  const first = paragraphs[0];
  if (!first) {
    return '';
  }
  const plain = first
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > MAX_DOC ? `${plain.slice(0, MAX_DOC - 1)}…` : plain;
}
