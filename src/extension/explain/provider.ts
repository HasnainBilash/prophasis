/** Why an explanation could not be made; each has a plain message in the panel. */
export type ExplainErrorCode =
  | 'noModel'
  | 'noPermission'
  | 'quota'
  | 'blocked'
  | 'tooLong'
  | 'untrusted'
  | 'declined'
  | 'cancelled'
  | 'failed';

export class ExplainError extends Error {
  constructor(
    readonly code: ExplainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExplainError';
  }
}

/**
 * Where explanations come from. Version 1 has one implementation, VS Code's
 * Language Model API (vscodeModel.ts); tests use an offline fake. A provider
 * using the user's own API key can be added behind this interface later.
 */
export interface ExplainProvider {
  /** The model that would answer, for the consent message; undefined if none is available. */
  modelName(): Promise<string | undefined>;
  /** Sends the prompt and returns the full answer. Throws ExplainError. */
  explain(prompt: string, signal: AbortSignal): Promise<string>;
}
