"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codeOf, throwUnlessOk, type components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The AI switches and the member's Frapp AI answer (#4308, #4790,
 * `spec/behavior/ai.md` § Consent), shared by web and mobile.
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

/**
 * True when the caller is the president of a chapter whose AI switches have
 * never been set: nobody has turned one on or off (`updated_at` is null).
 * That president's Continue on Meet Frapp AI turns the chapter's switches on
 * too, so a chapter that was just created has its AI working from the start
 * (Paul, 2026-11-13: "get these features going from the start"). A chapter
 * whose switches someone already set is left as it is.
 */
export function chapterAiNeverSet(
  settings: AiChapterSettings | null | undefined,
): boolean {
  return (
    !!settings &&
    settings.can_change &&
    settings.updated_at === null &&
    !settings.ask &&
    !settings.meeting_notes &&
    !settings.chat_source
  );
}

/**
 * The two answers on the Meet Frapp AI screen (#4790), for every place that
 * shows it: onboarding, the one ask on next open, an AI entry point, and
 * Settings.
 *
 * - `turnOn` records the member's Yes on the server's current version, and,
 *   for a president whose chapter never had its switches set
 *   ({@link chapterAiNeverSet}), turns the chapter's three switches on.
 *   Resolves `false` when the server has no AI. Rejects when a save fails,
 *   so the screen can say so and stay.
 * - `notNow` records a No, so the screen isn't put in front of them again by
 *   itself. They can turn it on in Settings or from an AI feature.
 */
export function useFrappAiChoice(options?: {
  /**
   * False when the active chapter may not be the one the member is in the
   * middle of (chapter setup before the new chapter is active): Continue
   * then never touches a chapter's switches.
   */
  includeChapter?: boolean;
}) {
  const consent = useAiConsent();
  const available = consent.data !== null && consent.data !== undefined;
  const includeChapter = options?.includeChapter ?? true;
  const settings = useAiChapterSettings({
    enabled: available && includeChapter,
  });
  const answer = useAnswerAiConsent();
  const updateSettings = useUpdateAiChapterSettings();
  const forChapter = includeChapter && chapterAiNeverSet(settings.data);
  const { refetch } = consent;
  const { mutateAsync: answerAsync } = answer;
  const { mutateAsync: updateSettingsAsync } = updateSettings;

  const readState = useCallback(async (): Promise<AiConsentState | null> => {
    if (consent.data !== undefined) return consent.data;
    const read = await refetch();
    if (read.error) throw read.error;
    return read.data ?? null;
  }, [consent.data, refetch]);

  const turnOn = useCallback(async (): Promise<boolean> => {
    const state = await readState();
    if (!state) return false;
    if (state.answer !== "yes") {
      await answerAsync({ sheet_version: state.sheet.version, answer: "yes" });
    }
    if (forChapter) {
      // The member's yes is saved by now, so a failure here is not a failed
      // Continue: Frapp AI is on for them, and the president can still turn
      // the chapter's switches on in Chapter settings. Reporting it as one
      // would hold them on the screen with their yes already counted.
      try {
        await updateSettingsAsync({
          ask: true,
          meeting_notes: true,
          chat_source: true,
        });
      } catch {
        // Left for Chapter settings, as above.
      }
    }
    return true;
  }, [answerAsync, forChapter, readState, updateSettingsAsync]);

  const notNow = useCallback(async (): Promise<void> => {
    const state = await readState();
    if (!state) return;
    await answerAsync({ sheet_version: state.sheet.version, answer: "no" });
  }, [answerAsync, readState]);

  return {
    /** The member's standing, `null` with AI off, `undefined` while read. */
    consent: consent.data,
    /** The read failed and nothing is cached: treat AI as unknown. */
    consentFailed: consent.isError && consent.data === undefined,
    /** The standing now, read again when nothing is cached yet. */
    readConsent: readState,
    providers: consent.data?.sheet.providers.map((p) => p.name) ?? [],
    forChapter,
    /**
     * Whether `forChapter` is known: the chapter's switches have been read,
     * or the read failed, or this screen never touches a chapter. A step
     * that waits on it never shows the member's wording and then the
     * chapter's under their finger.
     */
    chapterSettled:
      !includeChapter ||
      !available ||
      settings.data !== undefined ||
      settings.isError,
    turnOn,
    notNow,
    pending: answer.isPending || updateSettings.isPending,
  };
}

/**
 * Whether Meet Frapp AI should be put in front of the member by itself: the
 * server has AI and they have never answered on its current version. A
 * member who chose Not now has answered; they are not asked again unprompted.
 */
export function shouldMeetFrappAi(
  consent: AiConsentState | null | undefined,
): boolean {
  return !!consent && consent.answer === null;
}
