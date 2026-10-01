"use client";

import React, { createContext, useCallback, useEffect, useMemo } from "react";
import {
  useFrappClient,
  useActiveChapterId,
  useCurrentChapter,
} from "@repo/hooks";
import { isAnalyticsOptedOut, type AnalyticsProperties } from "@repo/validation";
import {
  applyAnalyticsOptOut,
  namedAnalyticsEventBody,
} from "@repo/observability/identified-posthog";

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
 * `subscriptionWriteState`. Web and mobile both read the flag from
 * `useCurrentChapter()` (`GET /v1/chapters/current`), the member view, which
 * every member can read. Web used to read it from `useOrgConfig()`, which needs
 * `chapter-config:view`: no seeded role below President holds it, so for them
 * the read always failed and the SDK was opted in (#2957).
 *
 * **Opted out until the member view answers.** While the chapter read is
 * pending, after it fails with nothing cached, or with no active chapter, the
 * provider treats the chapter as opted out: the SDK stays opted out and
 * `track` posts nothing. Opting in is the step that needs proof, because
 * nothing on the server stands behind what the PostHog SDK sends directly
 * (`spec/behavior/data-retention.md` #analytics-events-pseudonymous). Once a
 * payload has loaded, the shared predicate decides: only an explicit `true`
 * opts out.
 *
 * `track` posts named product events to the API only. PostHog JS does **not**
 * capture those names — the API adapter already forwards them, and a second
 * `posthog.capture` would double-count. The JS SDK is identify / groups /
 * flags / replay-gates / the `sentry-error-correlated` marker.
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
  // API repeats this check for `track` as defense-in-depth (data-retention.md
  // #analytics-events-pseudonymous). An officer's own Privacy-tab write
  // re-reads this payload when it settles (`usePatchOrgConfig`); another
  // member picks it up on the next refetch.
  const chapter = useCurrentChapter().data;
  const optedOut =
    chapter === undefined || isAnalyticsOptedOut(chapter.analytics_opt_out);

  useEffect(() => {
    applyAnalyticsOptOut(optedOut);
  }, [optedOut]);

  const track = useCallback<TrackFn>(
    (name, properties) => {
      if (optedOut) return;
      const body = namedAnalyticsEventBody({ name, chapterId, properties });
      if (!body) return;
      void client
        .POST("/v1/analytics/events", { body })
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
