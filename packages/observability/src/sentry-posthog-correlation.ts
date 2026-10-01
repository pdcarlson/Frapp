import { isPseudonymHex } from "./correlation";
import {
  captureSentryErrorCorrelated,
  getPostHogDistinctId,
  getPostHogReplayId,
  getPostHogSessionId,
} from "./posthog-adapter";
import { afterScrubber, sentryMarkerFrom } from "./sentry-event";

/**
 * The fields web and mobile Sentry events share for PostHog correlation.
 * Vendor event types are structural supersets of this.
 */
export interface CorrelatableSentryEvent {
  event_id?: string;
  transaction?: unknown;
  release?: unknown;
  user?: unknown;
  tags?: Record<string, unknown>;
  request?: { headers?: unknown };
  contexts?: {
    trace?: { trace_id?: unknown };
    response?: { status_code?: unknown };
  };
}

/**
 * After the scrubber runs, attach PostHog ids as tags (so an unknown-tag
 * rebuild cannot drop them) and emit the content-free timeline marker.
 *
 * Identified web/mobile only. Landing uses
 * `attachAnonymousPostHogCorrelation` from `@repo/observability/next`.
 */
export function attachPostHogCorrelation<T extends CorrelatableSentryEvent>(
  event: T,
  extras?: { statusClass?: string },
): T {
  const tags: Record<string, unknown> = {
    ...(event.tags ?? {}),
  };
  const distinct = getPostHogDistinctId();
  if (isPseudonymHex(distinct)) {
    tags.posthog_distinct_id = distinct;
  }
  const sessionId = getPostHogSessionId();
  if (sessionId) tags.posthog_session_id = sessionId;
  const replayId = getPostHogReplayId();
  if (replayId) tags.posthog_replay_id = replayId;
  event.tags = tags;

  try {
    captureSentryErrorCorrelated(sentryMarkerFrom(event, extras));
  } catch {
    // Never fail the Sentry send because the marker could not be queued.
  }

  return event;
}

export function withPostHogSentryCorrelation<
  E extends CorrelatableSentryEvent,
  H,
>(
  beforeSend?:
    | ((event: E, hint: H) => E | null | PromiseLike<E | null> | undefined)
    | undefined,
): (event: E, hint: H) => Promise<E | null> {
  return afterScrubber(beforeSend, attachPostHogCorrelation);
}
