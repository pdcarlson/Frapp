import React, { createContext, useCallback, useEffect, useMemo } from "react";
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
