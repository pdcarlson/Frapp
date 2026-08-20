import React, { createContext, useCallback, useMemo } from "react";
import {
  useFrappClient,
  useActiveChapterId,
  useCurrentChapter,
} from "@repo/hooks";
import {
  isAnalyticsOptedOut,
  type AnalyticsProperties,
  type CurrentChapterPayload,
} from "@repo/validation";

/**
 * Pseudonymous analytics for the mobile app (issue #464) — the Expo mirror of
 * the web provider.
 *
 * The client never holds the per-environment salt. It posts behavioral events
 * to the API (`POST /v1/analytics/events`), which derives the pseudonymous key
 * `hmac_sha256(salt, user_id)` server-side and enforces the per-chapter
 * opt-out. The raw user id never reaches the analytics provider, and the salt
 * never ships in the app bundle. See `spec/behavior/data-retention.md`
 * (#analytics-events-pseudonymous).
 *
 * Client-side opt-out is the fourth shared gate (`isAnalyticsOptedOut` in
 * `@repo/validation`), next to `can`, `isModuleEnabled`, and
 * `subscriptionWriteState`. The flag is read from `useCurrentChapter()` —
 * the same `GET /v1/chapters/current` payload mobile already uses for
 * `enabled_modules` — not a mobile-only one-off.
 *
 * `track` is fire-and-forget so a failed event never disrupts the UI.
 *
 * Without an active chapter id the server cannot apply the per-chapter
 * opt-out to a client event, so `track` is a no-op until one exists.
 *
 * There is no `useAnalytics` convenience hook — it had zero production
 * callers. Opt-out is enforced inside `track` itself, so a future emitter
 * that reads this context inherits the gate without a wrapper.
 */
type TrackFn = (name: string, properties?: AnalyticsProperties) => void;

/** @internal Context value is `track`. Not a product API. */
export const AnalyticsContext = createContext<TrackFn | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const chapterQuery = useCurrentChapter();
  const optedOut = isAnalyticsOptedOut(
    (chapterQuery.data as CurrentChapterPayload | undefined)?.analytics_opt_out,
  );

  const track = useCallback<TrackFn>(
    (name, properties) => {
      if (!chapterId) return;
      if (optedOut) return;
      void client
        .POST("/v1/analytics/events", {
          body: {
            name,
            chapter_id: chapterId,
            ...(properties ? { properties } : {}),
          },
        })
        .catch(() => {
          // Best-effort: analytics must never surface an error to the user.
        });
    },
    [client, chapterId, optedOut],
  );

  const value = useMemo(() => track, [track]);

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}
