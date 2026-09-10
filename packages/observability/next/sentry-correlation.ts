import {
  REQUEST_ID_HEADER,
  pickSentryErrorCorrelatedProperties,
} from "../src/index";

/**
 * Anonymous PostHog ↔ Sentry correlation: session/replay tags and the
 * content-free `sentry-error-correlated` marker.
 *
 * Does **not** attach `posthog_distinct_id`, call `identify`, or set
 * `Sentry.setUser`. Web adds the hex distinct id in `apps/web`. Landing
 * strips `user` and any distinct-id tag before calling this.
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

export function httpStatusClass(status: unknown): string | undefined {
  if (typeof status !== "number" || !Number.isFinite(status)) return undefined;
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return undefined;
}

export function headerValue(
  headers: unknown,
  name: string,
): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const record = headers as Record<string, unknown>;
  const direct = record[name] ?? record[name.toLowerCase()];
  return typeof direct === "string" && direct.length > 0 ? direct : undefined;
}

function asAnonymousEvent(event: object): AnonymousSentryEvent {
  return event as AnonymousSentryEvent;
}

export function traceIdFrom(event: object): string | undefined {
  const trace = asAnonymousEvent(event).contexts?.trace;
  if (!trace || typeof trace !== "object") return undefined;
  const id = (trace as { trace_id?: unknown }).trace_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function statusFrom(event: object): unknown {
  const view = asAnonymousEvent(event);
  const response = view.contexts?.response;
  if (response && typeof response === "object") {
    return (response as { status_code?: unknown }).status_code;
  }
  const tag = view.tags?.["http.status_code"];
  if (typeof tag === "number") return tag;
  if (typeof tag === "string") return Number(tag);
  return undefined;
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
        trace_id: traceIdFrom(event),
        request_id: headerValue(view.request?.headers, REQUEST_ID_HEADER),
        route:
          typeof view.transaction === "string" ? view.transaction : undefined,
        status_class: extras?.statusClass ?? httpStatusClass(statusFrom(event)),
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
    const statusClass = httpStatusClass(statusFrom(event));
    const next = beforeSend ? beforeSend(event, hint) : event;
    return Promise.resolve(next).then((resolved) =>
      resolved ? attach(resolved, { statusClass }) : null,
    );
  };
}
