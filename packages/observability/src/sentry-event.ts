/**
 * Readers for the two Sentry event fields both correlation paths need: the
 * trace id and the HTTP status. The identified path
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
