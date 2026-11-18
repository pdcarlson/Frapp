"use client";

import { useCallback } from "react";
import { useFrappClient } from "./use-frapp-client";

/** How long the phone waits for the cleanup before it keeps the raw words. */
export const ASK_DICTATION_TIMEOUT_MS = 3000;

/**
 * Dictation's cleanup in Ask's field (#5276, `spec/behavior/ai.md` § Ask
 * Frapp, Dictation): hands the words the phone's recogniser heard to
 * `POST /v1/ai/ask/dictation` and resolves them tidied.
 *
 * It never throws. Anything but a cleaned answer (offline, a refusal such as
 * `ai.consent.required`, a server error, the caller's abort, or no answer
 * within {@link ASK_DICTATION_TIMEOUT_MS}) resolves `null`, and the caller
 * keeps the raw words in the field. Nothing sends on its own: the member
 * reads, edits and sends.
 */
export function useCleanDictation(): (
  text: string,
  options?: { signal?: AbortSignal },
) => Promise<string | null> {
  const client = useFrappClient();
  return useCallback(
    async (text, options) => {
      const abort = new AbortController();
      const stop = () => abort.abort();
      const outer = options?.signal;
      if (outer?.aborted) return null;
      outer?.addEventListener("abort", stop);
      const timer = setTimeout(stop, ASK_DICTATION_TIMEOUT_MS);
      try {
        // A fetch that ignores its signal still loses the race.
        const aborted = new Promise<null>((resolve) => {
          abort.signal.addEventListener("abort", () => resolve(null));
        });
        const result = await Promise.race([
          client.POST("/v1/ai/ask/dictation", {
            body: { text },
            signal: abort.signal,
          }),
          aborted,
        ]);
        if (!result || abort.signal.aborted || !result.response.ok) return null;
        const cleaned = result.data?.text;
        return typeof cleaned === "string" && cleaned.trim() !== ""
          ? cleaned
          : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", stop);
      }
    },
    [client],
  );
}
