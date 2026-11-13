"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codeOf, throwUnlessOk, type components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The AI switches and the member's AI sheet (#4308, `spec/behavior/ai.md` §
 * Consent), shared by web and mobile.
 *
 * **Whether this server has AI at all** is read from the same calls: with
 * `AI_ENABLED` off, every AI route answers 404 `ai.not_available`, which
 * clients take as "hide every AI entry point" (`AiEnabledGuard`). These reads
 * turn that answer into `null` data rather than an error, so it is neither
 * retried nor reported to Sentry, and a screen hides its AI parts the same
 * way whether the server is off or the read has not come back.
 */

/** The current AI sheet and the caller's answer on it. */
export type AiConsentState = components["schemas"]["AiConsentStateDto"];
/** The chapter's AI switches, and whether the caller may change them. */
export type AiChapterSettings = components["schemas"]["AiChapterSettingsDto"];
export type AiChapterSettingsChange =
  components["schemas"]["UpdateAiChapterSettingsDto"];

/** Person-level: one answer covers every chapter, so no chapter in the key. */
export const aiConsentKey = ["ai", "consent"] as const;
const aiSettingsKey = (chapterId: string | null | undefined) =>
  ["ai", "settings", chapterId] as const;

/** A 2xx with no body is a broken response, not an answer. */
function bodyOf<T>(data: T | undefined): T {
  if (data === undefined) throw new Error("The AI route returned no body.");
  return data;
}

/** True for the answer of a server with `AI_ENABLED` off. */
export function isAiNotAvailable(error: unknown): boolean {
  return codeOf(error) === "ai.not_available";
}

/**
 * The caller's standing on the AI sheet, or `null` when the server has no AI.
 * `answer: null` means not answered, which counts as No.
 */
export function useAiConsent(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  return useQuery({
    queryKey: aiConsentKey,
    queryFn: async (): Promise<AiConsentState | null> => {
      const result = await client.GET("/v1/ai/consent");
      if (isAiNotAvailable(result.error)) return null;
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    // A deploy is what changes whether the server has AI, and the sheet's
    // version moves only with one; the member's own answer is written back
    // into this cache by `useAnswerAiConsent`.
    staleTime: 10 * 60_000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Whether this server has AI: `true`, `false`, or `undefined` while the read
 * is in flight or failed. A screen shows an AI entry point only on `true`.
 */
export function aiAvailableFrom(
  consent: { data: AiConsentState | null | undefined },
): boolean | undefined {
  if (consent.data === undefined) return undefined;
  return consent.data !== null;
}

/**
 * True only while an AI read's first attempt is in flight (#4504 item 7).
 * A page that has its own data and holds its skeleton so an AI part does not
 * arrive late and push it down waits on this, never on the retries after a
 * failure: the default retries run about seven seconds, and a failed AI read
 * should leave the page to draw without its AI part, as with AI off.
 */
export function isFirstAiReadInFlight(query: {
  isPending: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  failureCount: number;
}): boolean {
  return (
    query.isPending &&
    query.fetchStatus === "fetching" &&
    query.failureCount === 0
  );
}

/**
 * Answers the sheet for the version the member was shown. A 409
 * `ai.consent.stale_sheet` means the sheet changed since: the cached sheet is
 * refetched so the member reads the new one before answering again.
 */
export function useAnswerAiConsent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["ai-consent", "answer"],
    // An answer names a sheet version, so a retry after a lost response is
    // the same answer again: safe, but a stale-sheet refusal never improves.
    retry: false,
    mutationFn: async (body: {
      sheet_version: number;
      answer: "yes" | "no";
    }): Promise<AiConsentState> => {
      const result = await client.PUT("/v1/ai/consent", { body });
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    onSuccess: (state) => {
      queryClient.setQueryData(aiConsentKey, state);
      // A No deletes the member's nudge cards on the server; drop the
      // cached one so Activity stops drawing it. A Yes may be due one.
      void queryClient.resetQueries({ queryKey: ["member-nudge"] });
    },
    onError: (error) => {
      if (codeOf(error) === "ai.consent.stale_sheet") {
        void queryClient.invalidateQueries({ queryKey: aiConsentKey });
      }
    },
  });
}

/**
 * The active chapter's AI switches, or `null` when the server has no AI.
 * Every member may read them; `can_change` is true only for the president.
 */
export function useAiChapterSettings(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: aiSettingsKey(chapterId),
    queryFn: async (): Promise<AiChapterSettings | null> => {
      const result = await client.GET("/v1/ai/settings");
      if (isAiNotAvailable(result.error)) return null;
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    staleTime: 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/**
 * Turns the active chapter's AI switches on or off. President only: anyone
 * else gets 403 `ai.settings.president_only`. The server's answer replaces
 * the cache, so the page shows what was saved, not what was asked for.
 */
export function useUpdateAiChapterSettings() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["ai-settings", "update"],
    mutationFn: async (
      body: AiChapterSettingsChange,
    ): Promise<AiChapterSettings> => {
      const result = await client.PATCH("/v1/ai/settings", { body });
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(aiSettingsKey(chapterId), settings);
    },
    onError: () => {
      // A 403 means the presidency moved in another tab: read it again so
      // the switches turn read-only.
      void queryClient.invalidateQueries({ queryKey: aiSettingsKey(chapterId) });
    },
  });
}
