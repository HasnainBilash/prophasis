import { describe, expect, it } from 'vitest';
import type { FlowNode } from '../../src/shared/types';
import { displayName } from '../../src/webview/actions';

const card = (name: string, parentId?: string) => ({ name, parentId }) as FlowNode;

describe('displayName', () => {
  it('names a method card with its class', () => {
    const parent = 'file:///w/src/order.ts#class:OrderService@6:13';
    expect(displayName(card('constructor', parent))).toBe('OrderService.constructor');
  });

  it('keeps nested class names', () => {
    expect(displayName(card('run', 'file:///w/a.py#class:Outer.Inner@3:10'))).toBe(
      'Outer.Inner.run',
    );
  });

  it('leaves plain functions alone', () => {
    expect(displayName(card('total'))).toBe('total');
  });
});
