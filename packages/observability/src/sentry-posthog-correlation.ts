import { isPseudonymHex, REQUEST_ID_HEADER } from "./correlation";
import {
  captureSentryErrorCorrelated,
  getPostHogDistinctId,
  getPostHogReplayId,
  getPostHogSessionId,
} from "./posthog-adapter";
import { headerValue, httpStatusClass } from "./sentry-http";

export { headerValue, httpStatusClass } from "./sentry-http";

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

export interface PostHogSentryCorrelationOptions {
  /**
   * Landing visitors are anonymous PostHog UUIDs. Those must never become
   * Sentry `user.id` or `tags.posthog_distinct_id` — aliasing a marketing
   * visitor onto a later authenticated distinct id is rejected (ADR-22).
   */
  anonymous?: boolean;
}

function traceIdFrom(event: CorrelatableSentryEvent): string | undefined {
  const trace = event.contexts?.trace;
  if (!trace || typeof trace !== "object") return undefined;
  const id = trace.trace_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function statusFrom(event: CorrelatableSentryEvent): unknown {
  const response = event.contexts?.response;
  if (response && typeof response === "object") {
    return response.status_code;
  }
  const tag = event.tags?.["http.status_code"];
  if (typeof tag === "number") return tag;
  if (typeof tag === "string") return Number(tag);
  return undefined;
}

/**
 * After the scrubber runs, attach PostHog ids as tags (so an unknown-tag
 * rebuild cannot drop them) and emit the content-free timeline marker.
 */
export function attachPostHogCorrelation<T extends CorrelatableSentryEvent>(
  event: T,
  extras?: { statusClass?: string } & PostHogSentryCorrelationOptions,
): T {
  if (extras?.anonymous && event.user) {
    delete event.user;
  }
  const tags: Record<string, unknown> = {
    ...(event.tags ?? {}),
  };
  if (extras?.anonymous) {
    delete tags.posthog_distinct_id;
  } else {
    const distinct = getPostHogDistinctId();
    if (isPseudonymHex(distinct)) {
      tags.posthog_distinct_id = distinct;
    }
  }
  const sessionId = getPostHogSessionId();
  if (sessionId) tags.posthog_session_id = sessionId;
  const replayId = getPostHogReplayId();
  if (replayId) tags.posthog_replay_id = replayId;
  event.tags = tags;

  const requestId = headerValue(event.request?.headers, REQUEST_ID_HEADER);
  const traceId = traceIdFrom(event);
  try {
    captureSentryErrorCorrelated({
      sentry_event_id: event.event_id,
      trace_id: traceId,
      request_id: requestId,
      route: typeof event.transaction === "string" ? event.transaction : undefined,
      status_class: extras?.statusClass ?? httpStatusClass(statusFrom(event)),
      release: typeof event.release === "string" ? event.release : undefined,
    });
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
  options?: PostHogSentryCorrelationOptions,
): (event: E, hint: H) => Promise<E | null> {
  return (event: E, hint: H) => {
    // `contexts.response` is dropped by the scrubber allowlist. Read the
    // status class first so the timeline marker can still carry 2xx/4xx/5xx.
    const statusClass = httpStatusClass(statusFrom(event));
    const next = beforeSend ? beforeSend(event, hint) : event;
    return Promise.resolve(next).then((resolved) =>
      resolved
        ? attachPostHogCorrelation(resolved, {
            statusClass,
            anonymous: options?.anonymous,
          })
        : null,
    );
  };
}
