import type { BrowserOptions } from "@sentry/nextjs";
import {
  attachAnonymousPostHogCorrelation,
  withAnonymousPostHogSentryCorrelation,
} from "@repo/observability/next";
import {
  captureSentryErrorCorrelated,
  getPostHogReplayId,
  getPostHogSessionId,
} from "../posthog/client";

type BrowserErrorEvent = Parameters<NonNullable<BrowserOptions["beforeSend"]>>[0];

const landingPostHog = {
  getSessionId: getPostHogSessionId,
  getReplayId: getPostHogReplayId,
  captureSentryErrorCorrelated,
};

/**
 * After the scrubber runs, attach session/replay tags and emit the marker.
 *
 * Landing visitors are anonymous PostHog UUIDs. Those must never become
 * Sentry `user.id` or `tags.posthog_distinct_id` — aliasing a marketing
 * visitor onto a later authenticated distinct id is rejected (ADR-22).
 */
export function attachPostHogCorrelation(
  event: BrowserErrorEvent,
  extras?: { statusClass?: string },
): BrowserErrorEvent {
  if (event.user) {
    delete event.user;
  }
  const tags: Record<string, string> = {
    ...((event.tags as Record<string, string> | undefined) ?? {}),
  };
  delete tags.posthog_distinct_id;
  event.tags = tags;
  return attachAnonymousPostHogCorrelation(event, landingPostHog, extras);
}

export function withPostHogSentryCorrelation(
  beforeSend: BrowserOptions["beforeSend"],
): NonNullable<BrowserOptions["beforeSend"]> {
  return withAnonymousPostHogSentryCorrelation(
    beforeSend ?? undefined,
    attachPostHogCorrelation,
  ) as NonNullable<BrowserOptions["beforeSend"]>;
}
