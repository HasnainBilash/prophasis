import { describe, expect, it } from 'vitest';
import { LruCache } from '../../src/extension/engine/cache';
import { isAnonymousCallback, looksLikeFunctionValue } from '../../src/extension/engine/kinds';

describe('looksLikeFunctionValue (text after a variable name)', () => {
  it.each([
    ' = (value) => value.toFixed(2);',
    ' = async (a, b) => {',
    ' = x => x * 2;',
    ' = function () {',
    ' = async function named() {',
    ': Formatter = (value) => String(value);',
    ' = (', // parameters continue on the next line
    ' = lambda x: x * 2', // Python
  ])('treats "%s" as a function', (text) => {
    expect(looksLikeFunctionValue(text)).toBe(true);
  });

  it.each([' = 10;', ' = (a + b) * 2;', ' = someCall();', ' = { a: 1 };', ': number;', ' = "=>";'])(
    'treats "%s" as a plain value',
    (text) => {
      expect(looksLikeFunctionValue(text)).toBe(false);
    },
  );
});

describe('isAnonymousCallback', () => {
  it('spots TypeScript callback names', () => {
    expect(isAnonymousCallback('cart.items.reduce() callback')).toBe(true);
    expect(isAnonymousCallback('callback')).toBe(false);
    expect(isAnonymousCallback('handleCallback')).toBe(false);
  });
});

describe('LruCache', () => {
  it('drops the least recently used entry when full', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // a is now the most recent
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });
});
