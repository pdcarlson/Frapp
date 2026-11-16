import * as Sentry from "@sentry/nextjs";
import type { PostHog } from "posthog-js";
import {
  applyAnalyticsOptOut,
  canStartLivePostHogInit,
  isAnalyticsCaptureOptedOut,
  setLivePostHogAdapter,
} from "@repo/observability/identified-posthog";
import { afterFirstPaint } from "@/lib/after-first-paint";
import { buildWebPostHogInitOptions, webPostHogKey } from "./config";

/** Runs `start` once the page has loaded and the main thread is idle. */
export type PostHogLoadSchedule = (start: () => void) => void;

/**
 * Events (captures and route views) kept for the SDK while it loads, oldest
 * first. Only events are capped: an identity or consent call is never dropped,
 * because losing a late opt-out would start the SDK opted in (#2957).
 */
const MAX_QUEUED_EVENTS = 200;

type Call = (posthog: PostHog) => void;
type Properties = Parameters<PostHog["capture"]>[1];

/**
 * Init exactly once. No-op without `NEXT_PUBLIC_POSTHOG_KEY`. Tests bind a
 * memory adapter (or mock `posthog-js`) so they never open a transport.
 *
 * The adapter is bound synchronously, from `instrumentation-client.ts`, so
 * every identify, opt-out and route view the app makes from its first render
 * has somewhere to go. The SDK itself is not: `posthog-js` is the largest
 * library the dashboard loads (about 360 KB before compression), and loading
 * it before hydration made every cold open download it ahead of the chat it
 * was waiting to measure (#3716). It loads after the page's `load` event, on
 * an idle callback, and the calls made before it arrives replay in order once
 * it has initialized, each event stamped with the time it was made. Opt-out
 * is still honoured at call time, as before: a capture made while opted out
 * is dropped, not queued.
 *
 * Until the SDK arrives, the getters answer `undefined` (no session id, no
 * replay id, no flag), which is what they answered before `init` too. Sentry
 * events from that window carry no PostHog session id. If the chunk fails to
 * load, the queue is dropped and analytics stays off for the page.
 *
 * Returns the load, so tests can wait for it.
 */
export function initWebPostHog(
  schedule: PostHogLoadSchedule = afterFirstPaint,
): Promise<void> | undefined {
  if (!canStartLivePostHogInit()) return undefined;
  const key = webPostHogKey();
  if (!key) return undefined;
  if (typeof window === "undefined") return undefined;
  const options = buildWebPostHogInitOptions();

  let client: PostHog | null = null;
  let queue: Call[] | null = [];
  let queuedEvents = 0;
  /** An identity, consent or flag call: always kept, in order. */
  const run = (call: Call) => {
    if (client) call(client);
    else queue?.push(call);
  };
  /**
   * A capture. One sent from the queue carries the time it was made, so it
   * still lands at its place on the session's timeline.
   */
  const runEvent = (event: string, properties?: Properties) => {
    if (client) {
      client.capture(event, properties);
      return;
    }
    if (!queue || queuedEvents >= MAX_QUEUED_EVENTS) return;
    queuedEvents += 1;
    const timestamp = new Date();
    queue.push((posthog) => posthog.capture(event, properties, { timestamp }));
  };

  setLivePostHogAdapter({
    identify(distinctId) {
      run((posthog) => posthog.identify(distinctId));
    },
    reset() {
      run((posthog) => posthog.reset());
    },
    group(groupType, groupKey) {
      run((posthog) => posthog.group(groupType, groupKey));
    },
    resetGroups() {
      run((posthog) => posthog.resetGroups());
    },
    optOutCapturing() {
      run((posthog) => posthog.opt_out_capturing());
    },
    optInCapturing() {
      run((posthog) => {
        // Opting out stops replay with `stopSessionRecording()`, which sets
        // `disable_session_recording: true` for good: `opt_in_capturing()`
        // never clears it. Web is opted out on every load until the chapter
        // read answers (#2957), so restore the init-time setting first, or
        // replay would never run once it is enabled.
        posthog.set_config({
          disable_session_recording: options.disable_session_recording,
        });
        // No `$opt_in` event. An opt-in follows a settled chapter read, not a
        // person's choice, so the event would record nothing.
        posthog.opt_in_capturing({ captureEventName: false });
      });
    },
    stopSessionRecording() {
      run((posthog) => posthog.stopSessionRecording());
    },
    capture(event, properties) {
      if (isAnalyticsCaptureOptedOut()) return;
      runEvent(event, properties);
    },
    routeView(path) {
      if (isAnalyticsCaptureOptedOut()) return;
      // `path` is already a route template (#3382). Setting both URL
      // properties keeps posthog-js from filling them from
      // `window.location`, the same shape landing sends.
      runEvent("$pageview", { $pathname: path, $current_url: path });
    },
    getSessionId: () => client?.get_session_id() || undefined,
    getReplayId: () =>
      client?.sessionRecordingStarted()
        ? client.get_session_id() || undefined
        : undefined,
    getDistinctId: () => client?.get_distinct_id() || undefined,
    isFeatureEnabled: (flag) => client?.isFeatureEnabled(flag) ?? undefined,
    reloadFeatureFlags: () => {
      run((posthog) => posthog.reloadFeatureFlags());
    },
  });
  // Opted out from the start, until `AnalyticsProvider` has the chapter's
  // answer (#3477), as mobile is (#3101). The provider's own opt-out runs in
  // its passive effect, after its children's effects, and posthog-js starts
  // from whatever consent the last visit persisted. Without this, a capture
  // made before that effect (a child's first effect, the
  // `sentry-error-correlated` marker for a hydration error) was queued and
  // sent for a chapter whose answer was not in yet. Now it is dropped at call
  // time, and the SDK's first call once it loads is this opt-out. Flags still
  // load while opted out: posthog-js gates `/flags` on
  // `advanced_disable_feature_flags`, not on consent.
  applyAnalyticsOptOut(true);

  return new Promise<void>((resolve) => {
    schedule(() => {
      import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.init(key, options);
          client = posthog;
          const pending = queue ?? [];
          queue = null;
          // Each call on its own, as it would have run in its caller: one that
          // throws is reported and doesn't cancel the opt-out queued after it.
          for (const call of pending) {
            try {
              call(posthog);
            } catch (error) {
              Sentry.captureException(error, {
                tags: { surface: "posthog-replay" },
              });
            }
          }
        })
        .catch((error: unknown) => {
          // The SDK's chunk didn't load (or `init` threw): analytics stays
          // off for this page, and the queue goes with it.
          queue = null;
          Sentry.captureException(error, { tags: { surface: "posthog-load" } });
        })
        .finally(resolve);
    });
  });
}
