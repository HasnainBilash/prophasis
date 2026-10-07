import { Circle, square } from './shapes.js';

export function buildReport(radii) {
  const lines = radii.map((r) => new Circle(r).describe());
  lines.push(`largest square: ${square(Math.max(...radii))}`);
  return countdown(lines.length) + lines.join('\n');
}

export function countdown(n) {
  return n <= 0 ? '' : countdown(n - 1);
}
