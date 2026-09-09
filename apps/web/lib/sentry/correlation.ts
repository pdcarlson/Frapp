import type { BrowserOptions } from "@sentry/nextjs";
import { isPseudonymHex, REQUEST_ID_HEADER } from "@repo/observability";
import {
  captureSentryErrorCorrelated,
  getPostHogDistinctId,
  getPostHogReplayId,
  getPostHogSessionId,
} from "@/lib/posthog/client";

type BrowserErrorEvent = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[0];
type BrowserHint = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[1];

function headerValue(
  headers: unknown,
  name: string,
): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const record = headers as Record<string, unknown>;
  const direct = record[name] ?? record[name.toLowerCase()];
  return typeof direct === "string" && direct.length > 0 ? direct : undefined;
}

function httpStatusClass(status: unknown): string | undefined {
  if (typeof status !== "number" || !Number.isFinite(status)) return undefined;
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return undefined;
}

function traceIdFrom(event: BrowserErrorEvent): string | undefined {
  const trace = event.contexts?.trace;
  if (!trace || typeof trace !== "object") return undefined;
  const id = (trace as { trace_id?: unknown }).trace_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function statusFrom(event: BrowserErrorEvent): unknown {
  const response = event.contexts?.response;
  if (response && typeof response === "object") {
    return (response as { status_code?: unknown }).status_code;
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
export function attachPostHogCorrelation(
  event: BrowserErrorEvent,
  extras?: { statusClass?: string },
): BrowserErrorEvent {
  const tags: Record<string, string> = {
    ...((event.tags as Record<string, string> | undefined) ?? {}),
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

export function withPostHogSentryCorrelation(
  beforeSend: BrowserOptions["beforeSend"],
): NonNullable<BrowserOptions["beforeSend"]> {
  return (event: BrowserErrorEvent, hint: BrowserHint) => {
    // `contexts.response` is dropped by the scrubber allowlist. Read the
    // status class first so the timeline marker can still carry 2xx/4xx/5xx.
    const statusClass = httpStatusClass(statusFrom(event));
    const next = beforeSend ? beforeSend(event, hint) : event;
    return Promise.resolve(next).then((resolved) =>
      resolved ? attachPostHogCorrelation(resolved, { statusClass }) : null,
    );
  };
}
