import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
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
  createRouteViewRecorder,
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
 * (`$identify`, the `sentry-error-correlated` marker, route views, app
 * lifecycle events). Once a payload has
 * loaded, only an explicit `true` opts out (`spec/behavior/data-retention.md`
 * #analytics-events-pseudonymous).
 *
 * Each visit to a route is recorded once as a `$screen` named by its route
 * template (#3382), from the same gate, so an opted-out chapter sends none.
 * App lifecycle events are gated in `before_send` (`lib/posthog/config.ts`).
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

  // One `$screen` per visit, as its route template (#3382). Declared after the
  // opt-out effect so the gate the recorder checks is already current when
  // this runs, and keyed on `optedOut` so the route the member is on is
  // recorded once the chapter read opts in. The recorder keeps the visit, so a
  // gate that flips while the member stays put (a chapter switch reloads the
  // chapter read) records nothing more. expo-router's pathname drops params and
  // groups, so Chat home is `/` and a thread is `/chat-thread`. The params
  // only tell visits apart (a notification pushing another thread onto
  // `/chat-thread` is a new one); they are never sent.
  const pathname = usePathname();
  const visitKey = `${pathname} ${JSON.stringify(useGlobalSearchParams())}`;
  const [recordRouteView] = useState(createRouteViewRecorder);
  useEffect(() => {
    recordRouteView(pathname, visitKey);
  }, [optedOut, pathname, visitKey, recordRouteView]);

  const track = useCallback<TrackFn>(
    (name, properties) => {
      if (optedOut) return;
      const body = namedAnalyticsEventBody({
        name,
        app: "mobile",
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
