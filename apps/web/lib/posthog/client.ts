import type { PostHog } from "posthog-js";
import {
  canStartLivePostHogInit,
  isAnalyticsCaptureOptedOut,
  setLivePostHogAdapter,
} from "@repo/observability/identified-posthog";
import { afterFirstPaint } from "@/lib/after-first-paint";
import { buildWebPostHogInitOptions, webPostHogKey } from "./config";

/** Runs `start` once the page has loaded and the main thread is idle. */
export type PostHogLoadSchedule = (start: () => void) => void;

/** Calls made before the SDK arrives that are kept for it, oldest first. */
const MAX_QUEUED_CALLS = 200;

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
 * it has initialized. Opt-out is still honoured at call time, as before: a
 * capture made while opted out is dropped, not queued.
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
  let queue: Array<(posthog: PostHog) => void> | null = [];
  const run = (call: (posthog: PostHog) => void) => {
    if (client) {
      call(client);
      return;
    }
    if (queue && queue.length < MAX_QUEUED_CALLS) queue.push(call);
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
      run((posthog) => posthog.capture(event, properties));
    },
    routeView(path) {
      if (isAnalyticsCaptureOptedOut()) return;
      // `path` is already a route template (#3382). Setting both URL
      // properties keeps posthog-js from filling them from
      // `window.location`, the same shape landing sends.
      run((posthog) =>
        posthog.capture("$pageview", { $pathname: path, $current_url: path }),
      );
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

  return new Promise<void>((resolve) => {
    schedule(() => {
      import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.init(key, options);
          client = posthog;
          const pending = queue ?? [];
          queue = null;
          for (const call of pending) call(posthog);
        })
        .catch(() => {
          queue = null;
        })
        .finally(resolve);
    });
  });
}
