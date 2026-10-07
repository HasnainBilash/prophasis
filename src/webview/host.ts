import { toPanel, type ToHost, type ToPanel } from '../shared/messages';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi may only be called once per page.
const api = acquireVsCodeApi();

export function send(message: ToHost): void {
  api.postMessage(message);
}

/** Calls `handler` for every valid message from the extension; anything else is dropped. */
export function listen(handler: (message: ToPanel) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    const parsed = toPanel.safeParse(event.data);
    if (parsed.success) {
      handler(parsed.data);
    } else {
      console.warn('Prophasis: ignored an unexpected message', parsed.error.issues[0]);
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
