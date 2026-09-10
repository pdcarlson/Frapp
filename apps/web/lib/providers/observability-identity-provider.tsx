"use client";

import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "@repo/hooks";
import * as Sentry from "@sentry/nextjs";
import { webSentryDsn } from "@/lib/sentry/options";
import {
  applyObservabilityIdentity,
  fetchAnalyticsIdentity,
} from "@repo/observability";
import { isPostHogConfigured } from "@/lib/posthog/config";

/**
 * Attaches the caller's **server-derived** pseudonym to PostHog and Sentry.
 *
 * Replaces `SentryIdentityProvider`. The salt is API-only (`ENV_REFERENCE.md`);
 * this provider only ever *reads* `{ distinct_id, enabled, chapter_group_id }`
 * from `GET /v1/analytics/identity` and rejects anything that is not 64
 * lowercase hex. Chapter switches refetch because `chapter_group_id` is a
 * function of the active chapter.
 *
 * Opt-out still identifies (so opt-in does not need a refetch) and still sets
 * Sentry `user.id` — it only stops capturing. `enabled: false` from the API
 * means analytics is unconfigured; that is not the same as opt-out.
 */
export function ObservabilityIdentityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const fetchEnabled = Boolean(webSentryDsn()) || isPostHogConfigured();

  const { data } = useQuery({
    queryKey: ["observability-identity", chapterId ?? "none"],
    queryFn: () =>
      fetchAnalyticsIdentity(() => client.GET("/v1/analytics/identity")),
    enabled: fetchEnabled,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!fetchEnabled) return;
    if (data === undefined) return;
    applyObservabilityIdentity(data, Sentry.setUser);
  }, [data, fetchEnabled]);

  return <>{children}</>;
}
