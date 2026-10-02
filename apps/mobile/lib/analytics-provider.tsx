import React, { createContext, useCallback, useEffect, useMemo } from "react";
import {
  useFrappClient,
  useActiveChapterId,
  useCurrentChapter,
} from "@repo/hooks";
import {
  isChapterAnalyticsOptedOut,
  type AnalyticsProperties,
} from "@repo/validation";
import {
  applyAnalyticsOptOut,
  namedAnalyticsEventBody,
} from "@repo/observability/identified-posthog";

/**
 * Expo `track` for named product events. Posts `POST /v1/analytics/events`
 * only — PostHog RN does not capture those names. Without an active chapter
 * the server cannot apply per-chapter opt-out, so `track` is a no-op.
 *
 * Opt-out is read from `useCurrentChapter()` (`GET /v1/chapters/current`),
 * not `useOrgConfig`. Fire-and-forget: a failed post never surfaces in UI.
 *
 * **Opted out until that read answers** (`isChapterAnalyticsOptedOut`, as web
 * does; #3101). While it is pending, after it fails with nothing cached, or
 * with no active chapter, the PostHog SDK stays opted out and `track` posts
 * nothing: nothing on the server stands behind what the SDK sends directly
 * (`$identify`, the `sentry-error-correlated` marker). Once a payload has
 * loaded, only an explicit `true` opts out (`spec/behavior/data-retention.md`
 * #analytics-events-pseudonymous).
 */
type TrackFn = (name: string, properties?: AnalyticsProperties) => void;

/** @internal Context value is `track`. Not a product API. */
export const AnalyticsContext = createContext<TrackFn | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const chapterQuery = useCurrentChapter();
  const optedOut = isChapterAnalyticsOptedOut(chapterQuery.data);

  useEffect(() => {
    applyAnalyticsOptOut(optedOut);
  }, [optedOut]);

  const track = useCallback<TrackFn>(
    (name, properties) => {
      if (optedOut) return;
      const body = namedAnalyticsEventBody({
        name,
        chapterId,
        properties,
        requireChapter: true,
      });
      if (!body) return;
      void client
        .POST("/v1/analytics/events", { body })
        .catch(() => undefined);
    },
    [chapterId, client, optedOut],
  );

  const value = useMemo(() => track, [track]);
  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}
