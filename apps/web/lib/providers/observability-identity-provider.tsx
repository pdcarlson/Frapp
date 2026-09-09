"use client";

import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "@repo/hooks";
import * as Sentry from "@sentry/nextjs";
import { webSentryDsn } from "@/lib/sentry/options";
import { isPostHogConfigured } from "@/lib/posthog/config";
import { applyAnalyticsIdentity } from "@/lib/posthog/client";
import { validatedDistinctId } from "@/lib/posthog/identity";

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
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/analytics/identity");
      if (error) throw error;
      return data ?? null;
    },
    enabled: fetchEnabled,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!fetchEnabled) return;
    if (data === undefined) return;
    applyAnalyticsIdentity(data);
    const distinctId = validatedDistinctId(data);
    Sentry.setUser(distinctId ? { id: distinctId } : null);
  }, [data, fetchEnabled]);

  return <>{children}</>;
}
