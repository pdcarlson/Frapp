import type { BrowserOptions } from "@sentry/nextjs";
import { isPseudonymHex } from "@repo/observability";
import {
  attachAnonymousPostHogCorrelation,
  withAnonymousPostHogSentryCorrelation,
} from "@repo/observability/next";
import {
  captureSentryErrorCorrelated,
  getPostHogDistinctId,
  getPostHogReplayId,
  getPostHogSessionId,
} from "@/lib/posthog/client";

type BrowserErrorEvent = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[0];

const webPostHog = {
  getSessionId: getPostHogSessionId,
  getReplayId: getPostHogReplayId,
  captureSentryErrorCorrelated,
};

/**
 * After the scrubber runs, attach the validated PostHog *distinct* id
 * (web-only) plus the anonymous session/replay tags and marker.
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
  event.tags = tags;
  return attachAnonymousPostHogCorrelation(event, webPostHog, extras);
}

export function withPostHogSentryCorrelation(
  beforeSend: BrowserOptions["beforeSend"],
): NonNullable<BrowserOptions["beforeSend"]> {
  return withAnonymousPostHogSentryCorrelation(
    beforeSend ?? undefined,
    attachPostHogCorrelation,
  ) as NonNullable<BrowserOptions["beforeSend"]>;
}
