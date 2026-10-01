import { REQUEST_ID_HEADER } from "./correlation";
import { headerValue, httpStatusClass } from "./sentry-http";

/**
 * What both correlation paths read off a Sentry event: the trace id, the HTTP
 * status, the `sentry-error-correlated` marker body, and the `beforeSend`
 * wrapper that carries the status past the scrubber. The identified path
 * (`sentry-posthog-correlation.ts`) and the anonymous one
 * (`next/sentry-correlation.ts`) share these, so the two cannot drift.
 */

/**
 * The fields read here. Vendor event types, `CorrelatableSentryEvent` and
 * `AnonymousSentryEvent` are all structural supersets of it.
 */
export interface SentryEventFields {
  tags?: Record<string, unknown>;
  contexts?: { trace?: unknown; response?: unknown };
}

export function traceIdFrom(event: SentryEventFields): string | undefined {
  const trace = event.contexts?.trace;
  if (!trace || typeof trace !== "object") return undefined;
  const id = "trace_id" in trace ? trace.trace_id : undefined;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * `contexts.response.status_code` when a response context exists (even with
 * no status on it), else the `http.status_code` tag.
 */
export function statusFrom(event: SentryEventFields): unknown {
  const response = event.contexts?.response;
  if (response && typeof response === "object") {
    return "status_code" in response ? response.status_code : undefined;
  }
  const tag = event.tags?.["http.status_code"];
  if (typeof tag === "number") return tag;
  if (typeof tag === "string") return Number(tag);
  return undefined;
}

/** The marker's inputs. Vendor event types are structural supersets of it. */
export interface SentryMarkerFields extends SentryEventFields {
  event_id?: unknown;
  transaction?: unknown;
  release?: unknown;
  request?: { headers?: unknown };
}

/**
 * The raw `sentry-error-correlated` marker body. Not allowlisted: the sink
 * (`captureSentryErrorCorrelated` / `pickSentryErrorCorrelatedProperties`)
 * drops unknown keys and non-string values.
 */
export function sentryMarkerFrom(
  event: SentryMarkerFields,
  extras?: { statusClass?: string },
): Record<string, unknown> {
  return {
    sentry_event_id: event.event_id,
    trace_id: traceIdFrom(event),
    request_id: headerValue(event.request?.headers, REQUEST_ID_HEADER),
    route:
      typeof event.transaction === "string" ? event.transaction : undefined,
    status_class: extras?.statusClass ?? httpStatusClass(statusFrom(event)),
    release: typeof event.release === "string" ? event.release : undefined,
  };
}

/**
 * Run the scrubber first, then `attach`. `contexts.response` is dropped by the
 * scrubber allowlist, so the status class is read before scrubbing and handed
 * to `attach`. A dropped event is not attached.
 */
export function afterScrubber<E extends object, H>(
  beforeSend:
    | ((event: E, hint: H) => E | null | PromiseLike<E | null> | undefined)
    | undefined,
  attach: (event: E, extras: { statusClass?: string }) => E,
): (event: E, hint: H) => Promise<E | null> {
  return (event: E, hint: H) => {
    const statusClass = httpStatusClass(statusFrom(event as SentryEventFields));
    const next = beforeSend ? beforeSend(event, hint) : event;
    return Promise.resolve(next).then((resolved) =>
      resolved ? attach(resolved, { statusClass }) : null,
    );
  };
}
