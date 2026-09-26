import {
  REQUEST_ID_HEADER,
  headerValue,
  httpStatusClass,
  pickSentryErrorCorrelatedProperties,
} from "../src/index";
import { statusFrom, traceIdFrom } from "../src/sentry-event";

export { headerValue, httpStatusClass } from "../src/index";

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
      pickSentryErrorCorrelatedProperties({
        sentry_event_id: view.event_id,
        trace_id: traceIdFrom(view),
        request_id: headerValue(view.request?.headers, REQUEST_ID_HEADER),
        route:
          typeof view.transaction === "string" ? view.transaction : undefined,
        status_class: extras?.statusClass ?? httpStatusClass(statusFrom(view)),
        release: typeof view.release === "string" ? view.release : undefined,
      }),
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

/**
 * Run the scrubber first, then the anonymous attach. `contexts.response` is
 * dropped by the scrubber allowlist, so status class is read before scrubbing.
 */
export function withAnonymousPostHogSentryCorrelation<
  TEvent extends object,
  THint = unknown,
>(
  beforeSend: AnonymousBeforeSend<TEvent, THint> | undefined,
  attach: (
    event: TEvent,
    extras?: { statusClass?: string },
  ) => TEvent,
): (event: TEvent, hint: THint) => Promise<TEvent | null> {
  return (event: TEvent, hint: THint) => {
    const statusClass = httpStatusClass(statusFrom(asAnonymousEvent(event)));
    const next = beforeSend ? beforeSend(event, hint) : event;
    return Promise.resolve(next).then((resolved) =>
      resolved ? attach(resolved, { statusClass }) : null,
    );
  };
}
