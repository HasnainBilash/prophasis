import { describe, expect, it } from 'vitest';
import { docFromHover } from '../../src/extension/engine/docs';
import { Explainer, type ExplainHooks } from '../../src/extension/explain/explainer';
import { buildPrompt, type CodePiece } from '../../src/extension/explain/prompts';
import { ExplainError, type ExplainProvider } from '../../src/extension/explain/provider';

describe('docFromHover', () => {
  it('takes the doc text after the signature (TypeScript)', () => {
    const hover =
      '```typescript\nfunction validateCart(cart: Cart): boolean\n```\nChecks that a cart can be ordered.\n\n*@param* `cart` — the cart';
    expect(docFromHover(hover)).toBe('Checks that a cart can be ordered.');
  });

  it('takes the docstring after the rule (Python / Pylance)', () => {
    const hover =
      '```python\n(function) def validate_cart(cart: dict) -> bool\n```\n---\nChecks that a cart can be ordered.\n\nArgs:\n  cart: the cart';
    expect(docFromHover(hover)).toBe('Checks that a cart can be ordered.');
  });

  it('drops hidden HTML markers that Pylance adds', () => {
    expect(docFromHover('Checks that a cart can be ordered. <!--moduleHash:3529462-->')).toBe(
      'Checks that a cart can be ordered.',
    );
  });

  it('is empty without a doc comment, and cuts long ones', () => {
    expect(docFromHover('```ts\nfunction f(): void\n```')).toBe('');
    expect(docFromHover('x'.repeat(500)).length).toBe(160);
  });
});

const piece = (label: string, code: string): CodePiece => ({ label, language: 'typescript', code });

describe('buildPrompt', () => {
  it('sends the code with plain-language instructions in the display language', () => {
    const prompt = buildPrompt([piece('function total', 'return 1;')], 'single', 1000, 'bn');
    expect(prompt.text).toContain('```typescript\nreturn 1;\n```');
    expect(prompt.text).toContain('Answer in the language with this code: bn');
    expect(prompt.truncated).toBe(false);
    expect(prompt.codeCharacters).toBe(9);
  });

  it('cuts code to the cap, sharing it between the steps of a path', () => {
    const prompt = buildPrompt(
      [piece('a', 'A'.repeat(100)), piece('b', 'B'.repeat(100))],
      'path',
      100,
      'en',
    );
    expect(prompt.truncated).toBe(true);
    expect(prompt.codeCharacters).toBe(100);
    expect(prompt.text).toContain('Step 1: a');
    expect(prompt.text).toContain('Step 2: b');
    expect(prompt.text).toContain(`${'A'.repeat(50)}\n// … cut to fit`);
  });

  it('gives the same request the same hash, and different code a different one', () => {
    const one = buildPrompt([piece('f', 'x')], 'single', 100, 'en');
    expect(buildPrompt([piece('f', 'x')], 'single', 100, 'en').hash).toBe(one.hash);
    expect(buildPrompt([piece('f', 'y')], 'single', 100, 'en').hash).not.toBe(one.hash);
  });
});

/** An offline stand-in for the language model. */
function setup(options: { model?: string; trusted?: boolean; consent?: 'once' | 'always' } = {}) {
  const calls: string[] = [];
  const asked: string[] = [];
  let remembered = false;
  const provider: ExplainProvider = {
    modelName: async () => ('model' in options ? options.model : 'Fake Model'),
    explain: async (prompt) => {
      calls.push(prompt);
      return 'It adds things up.';
    },
  };
  const hooks: ExplainHooks = {
    isTrusted: () => options.trusted ?? true,
    consentGiven: () => remembered,
    rememberConsent: async () => {
      remembered = true;
    },
    askConsent: async (message) => {
      asked.push(message);
      return options.consent;
    },
  };
  const explainer = new Explainer(provider, hooks, () => ({
    maxCharacters: 1000,
    displayLanguage: 'en',
  }));
  return { explainer, calls, asked };
}

const signal = new AbortController().signal;
const code = [piece('function total (src/a.ts, line 3)', 'return a + b;')];

describe('Explainer', () => {
  it('asks first, naming the model and the amount of code, then explains', async () => {
    const { explainer, calls, asked } = setup({ consent: 'once' });
    const result = await explainer.explain(code, 'single', signal);
    expect(result).toEqual({
      text: 'It adds things up.',
      model: 'Fake Model',
      truncated: false,
      cached: false,
    });
    expect(asked[0]).toContain('function total (src/a.ts, line 3) (13 characters) to Fake Model');
    expect(calls[0]).toContain('return a + b;');
  });

  it('sends nothing when the user declines', async () => {
    const { explainer, calls } = setup({ consent: undefined });
    await expect(explainer.explain(code, 'single', signal)).rejects.toMatchObject({
      code: 'declined',
    });
    expect(calls).toHaveLength(0);
  });

  it('asks again next time after "once", but not after "always"', async () => {
    const once = setup({ consent: 'once' });
    await once.explainer.explain(code, 'single', signal);
    await once.explainer.explain([piece('other', 'x')], 'single', signal);
    expect(once.asked).toHaveLength(2);

    const always = setup({ consent: 'always' });
    await always.explainer.explain(code, 'single', signal);
    await always.explainer.explain([piece('other', 'x')], 'single', signal);
    expect(always.asked).toHaveLength(1);
  });

  it('explains the same code once per session', async () => {
    const { explainer, calls } = setup({ consent: 'always' });
    await explainer.explain(code, 'single', signal);
    const again = await explainer.explain(code, 'single', signal);
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('is off in untrusted workspaces and without a model', async () => {
    await expect(
      setup({ trusted: false }).explainer.explain(code, 'single', signal),
    ).rejects.toMatchObject({
      code: 'untrusted',
    });
    await expect(
      setup({ model: undefined }).explainer.explain(code, 'single', signal),
    ).rejects.toBeInstanceOf(ExplainError);
  });
});
