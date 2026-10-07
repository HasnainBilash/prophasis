import { buildPrompt, type CodePiece } from './prompts';
import { ExplainError, type ExplainProvider } from './provider';

export interface ExplainSettings {
  maxCharacters: number;
  /** The VS Code display language, e.g. "en" or "bn"; answers use it. */
  displayLanguage: string;
}

export interface ExplainHooks {
  /** Explain is off in untrusted workspaces. */
  isTrusted(): boolean;
  /** Asks before sending code; "always" means don't ask again. */
  askConsent(message: string): Promise<'once' | 'always' | undefined>;
  /** Remembers "don't ask again" across sessions. */
  consentGiven(): boolean;
  rememberConsent(): Promise<void>;
}

export interface Explanation {
  text: string;
  model: string;
  /** Some code was cut to fit the size cap. */
  truncated: boolean;
  /** Served from memory, without asking the model again. */
  cached: boolean;
}

/**
 * Turns code into a plain-language explanation. Only runs on a user action,
 * only after consent, only with the chosen code (capped), and never stores
 * anything on disk: answers are kept in memory by a hash of the exact request.
 */
export class Explainer {
  private readonly cache = new Map<string, { text: string; model: string }>();

  constructor(
    private readonly provider: ExplainProvider,
    private readonly hooks: ExplainHooks,
    private readonly settings: () => ExplainSettings,
  ) {}

  async explain(
    pieces: CodePiece[],
    kind: 'single' | 'path',
    signal: AbortSignal,
  ): Promise<Explanation> {
    if (!this.hooks.isTrusted()) {
      throw new ExplainError(
        'untrusted',
        'Explain is off in untrusted workspaces, because it sends code to a language model. Trust this folder to use it.',
      );
    }
    const { maxCharacters, displayLanguage } = this.settings();
    const prompt = buildPrompt(pieces, kind, maxCharacters, displayLanguage);
    const cached = this.cache.get(prompt.hash);
    if (cached) {
      return { ...cached, truncated: prompt.truncated, cached: true };
    }

    const model = await this.provider.modelName();
    if (!model) {
      throw new ExplainError(
        'noModel',
        'No language model is available. Explain uses GitHub Copilot through VS Code: sign in to Copilot (the free plan works) and try again.',
      );
    }
    if (!this.hooks.consentGiven()) {
      const what =
        kind === 'path'
          ? `${pieces.length} functions on this path`
          : (pieces[0]?.label ?? 'this code');
      const answer = await this.hooks.askConsent(
        `Prophasis will send the code of ${what} (${prompt.codeCharacters.toLocaleString('en')} characters${prompt.truncated ? ', cut to fit' : ''}) to ${model} through VS Code's language model API. Nothing is stored on disk.`,
      );
      if (!answer) {
        throw new ExplainError('declined', 'Nothing was sent.');
      }
      if (answer === 'always') {
        await this.hooks.rememberConsent();
      }
    }

    const text = await this.provider.explain(prompt.text, signal);
    this.cache.set(prompt.hash, { text, model });
    return { text, model, truncated: prompt.truncated, cached: false };
  }
}
