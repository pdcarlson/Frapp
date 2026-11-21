import {
  LanguageModelError,
  type AiProvider,
} from '#domain/adapters/language-model.interface';

/**
 * Waits, or rejects with the port's `aborted` error the moment the signal
 * fires: what an adapter that polls, or pretends to work, waits with.
 */
export function abortableSleep(
  ms: number,
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new LanguageModelError('aborted', provider));
  }
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(new LanguageModelError('aborted', provider));
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}
