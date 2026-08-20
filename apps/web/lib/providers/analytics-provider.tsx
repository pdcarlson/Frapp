"use client";

import React, { createContext, useCallback, useMemo } from "react";
import { useFrappClient, useActiveChapterId } from "@repo/hooks";
import { isAnalyticsOptedOut, type AnalyticsProperties } from "@repo/validation";
import { useOrgConfig } from "@/lib/hooks/use-org-config";

/**
 * Pseudonymous analytics for the web app (issue #464).
 *
 * The client never holds the per-environment salt. It posts behavioral events
 * to the API (`POST /v1/analytics/events`), which derives the pseudonymous key
 * `hmac_sha256(salt, user_id)` server-side and enforces the per-chapter
 * opt-out. The raw user id never reaches the analytics provider, and the salt
 * never reaches the browser bundle — keeping the dataset un-rainbow-tableable
 * per `spec/behavior/data-retention.md` (#analytics-events-pseudonymous).
 *
 * Client-side opt-out is the fourth shared gate (`isAnalyticsOptedOut` in
 * `@repo/validation`), next to `can`, `isModuleEnabled`, and
 * `subscriptionWriteState`. Web reads the flag from `useOrgConfig()`
 * (`GET /v1/chapters/{id}/config`); mobile reads the same scalar from
 * `useCurrentChapter()`.
 *
 * `track` is fire-and-forget: a failed event must never disrupt the UI.
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
  // First gate, enforced at the SDK boundary via the shared predicate: when
  // the active chapter has opted out, emit zero events for its members. The
  // API repeats this check as defense-in-depth (data-retention.md
  // #analytics-events-pseudonymous), so the ~5min config staleTime window
  // before this client refetches is acceptable.
  const optedOut = isAnalyticsOptedOut(useOrgConfig().data?.analytics_opt_out);

  const track = useCallback<TrackFn>(
    (name, properties) => {
      if (optedOut) return;
      void client
        .POST("/v1/analytics/events", {
          body: {
            name,
            ...(chapterId ? { chapter_id: chapterId } : {}),
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
