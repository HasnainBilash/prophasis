import * as vscode from 'vscode';
import { ExplainError, type ExplainProvider } from './provider';

/**
 * Explanations through VS Code's Language Model API, using the models the
 * user's GitHub Copilot access provides. VS Code asks the user once whether
 * Prophasis may use them. Must only be called from a user action.
 */
export function createVscodeModelProvider(): ExplainProvider {
  const pick = async () => {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models[0];
  };

  return {
    async modelName() {
      return (await pick())?.name;
    },

    async explain(prompt, signal) {
      const model = await pick();
      if (!model) {
        throw new ExplainError(
          'noModel',
          'No language model is available. Explain uses GitHub Copilot through VS Code: sign in to Copilot (the free plan works) and try again.',
        );
      }
      if ((await model.countTokens(prompt)) > model.maxInputTokens) {
        throw new ExplainError(
          'tooLong',
          'This code is too long for the model. Lower prophasis.explain.maxCharacters or explain a smaller part.',
        );
      }
      const source = new vscode.CancellationTokenSource();
      signal.addEventListener('abort', () => source.cancel());
      try {
        const response = await model.sendRequest(
          [vscode.LanguageModelChatMessage.User(prompt)],
          { justification: 'Prophasis explains the code you chose in plain language.' },
          source.token,
        );
        let text = '';
        for await (const fragment of response.text) {
          text += fragment;
        }
        return text.trim();
      } catch (error) {
        throw toExplainError(error);
      } finally {
        source.dispose();
      }
    },
  };
}

function toExplainError(error: unknown): ExplainError {
  if (error instanceof vscode.CancellationError) {
    return new ExplainError('cancelled', 'Cancelled.');
  }
  if (error instanceof vscode.LanguageModelError) {
    if (error.code === vscode.LanguageModelError.NoPermissions().code) {
      return new ExplainError(
        'noPermission',
        'Prophasis may not use the language model yet. Allow it when VS Code asks, then try again.',
      );
    }
    if (error.code === vscode.LanguageModelError.Blocked().code) {
      return new ExplainError(
        'blocked',
        'The language model refused this request, or its limit is reached for now. Try again later.',
      );
    }
    if (error.code === vscode.LanguageModelError.NotFound().code) {
      return new ExplainError('noModel', 'The language model is no longer available.');
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/quota|rate limit|too many/i.test(message)) {
    return new ExplainError(
      'quota',
      'The language model limit is reached for now. Try again later.',
    );
  }
  return new ExplainError('failed', `The explanation failed: ${message}`);
}
