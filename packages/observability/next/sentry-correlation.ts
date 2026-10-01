import { pickSentryErrorCorrelatedProperties } from "../src/index";
import { afterScrubber, sentryMarkerFrom } from "../src/sentry-event";

/**
 * Anonymous PostHog ↔ Sentry correlation: session/replay tags and the
 * content-free `sentry-error-correlated` marker.
 *
 * Does **not** attach `posthog_distinct_id`, call `identify`, or set
 * `Sentry.setUser`. Identified web/mobile add the hex distinct id via
 * `@repo/observability/identified-posthog`. Landing strips `user` and
 * any distinct-id tag before calling this.
 */

export interface AnonymousSentryEvent {
  event_id?: unknown;
  release?: unknown;
  transaction?: unknown;
  user?: unknown;
  tags?: Record<string, unknown>;
  request?: { headers?: unknown };
  contexts?: Record<string, unknown>;
}

export interface AnonymousPostHogCorrelationSource {
  getSessionId(): string | undefined;
  getReplayId(): string | undefined;
  captureSentryErrorCorrelated(properties: Record<string, unknown>): void;
}

function asAnonymousEvent(event: object): AnonymousSentryEvent {
  return event as AnonymousSentryEvent;
}

/**
 * Session/replay tags + timeline marker. Never writes `posthog_distinct_id`
 * or `user`.
 *
 * Constrained to `object` (not {@link AnonymousSentryEvent}) so Sentry's
 * `ErrorEvent` — which has a required `type` and no index signature — can
 * pass through without a cast.
 */
export function attachAnonymousPostHogCorrelation<TEvent extends object>(
  event: TEvent,
  source: AnonymousPostHogCorrelationSource,
  extras?: { statusClass?: string },
): TEvent {
  const view = asAnonymousEvent(event);
  const tags: Record<string, string> = {
    ...((view.tags as Record<string, string> | undefined) ?? {}),
  };
  const sessionId = source.getSessionId();
  if (sessionId) tags.posthog_session_id = sessionId;
  const replayId = source.getReplayId();
  if (replayId) tags.posthog_replay_id = replayId;
  (event as AnonymousSentryEvent).tags = tags;

  try {
    source.captureSentryErrorCorrelated(
      pickSentryErrorCorrelatedProperties(sentryMarkerFrom(view, extras)),
    );
  } catch {
    // Never fail the Sentry send because the marker could not be queued.
  }

  return event;
}

export type AnonymousBeforeSend<TEvent, THint = unknown> = (
  event: TEvent,
  hint: THint,
) => TEvent | null | PromiseLike<TEvent | null> | undefined;

/** Run the scrubber first, then the anonymous attach. */
export function withAnonymousPostHogSentryCorrelation<
  TEvent extends object,
  THint = unknown,
>(
  beforeSend: AnonymousBeforeSend<TEvent, THint> | undefined,
  attach: (event: TEvent, extras?: { statusClass?: string }) => TEvent,
): (event: TEvent, hint: THint) => Promise<TEvent | null> {
  return afterScrubber(beforeSend, attach);
}
