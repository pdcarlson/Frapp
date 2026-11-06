import {
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ContextType,
} from "react";
import { AnalyticsContext } from "@/lib/analytics-provider";

type TrackFn = NonNullable<ContextType<typeof AnalyticsContext>>;

/**
 * The analytics `track` from `AnalyticsContext`, as one function that keeps
 * its identity and always calls the context's current value. Outside
 * `AnalyticsProvider` it sends nothing.
 *
 * For a caller that tracks after an `await`, or hands `track` to something
 * long-lived. `track` changes once the chapter's opt-out answer arrives, and
 * until then it is the opted-out no-op. So a "Turn on" tapped right after
 * joining, answered once the OS prompt closes, would otherwise call the no-op
 * it captured and drop the answer. And chat's `ctx` would change identity,
 * which re-runs its flush effect and starts a second flush.
 *
 * The cost of reading late: an event sent after a chapter switch goes under
 * the chapter that is active when it is sent, gated by that chapter's opt-out
 * (`spec/behavior/observability.md` § Outbox Telemetry).
 */
export function useLatestTrack(): TrackFn {
  const track = useContext(AnalyticsContext);
  const trackRef = useRef(track);
  useLayoutEffect(() => {
    trackRef.current = track;
  }, [track]);
  return useCallback<TrackFn>(
    (event, properties) => trackRef.current?.(event, properties),
    [],
  );
}
