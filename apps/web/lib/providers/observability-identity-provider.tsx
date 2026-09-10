"use client";

import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "@repo/hooks";
import * as Sentry from "@sentry/nextjs";
import { useAuthUserId } from "@/lib/auth/use-auth-user-id";
import { webSentryDsn } from "@/lib/sentry/options";
import {
  applyFetchedObservabilityIdentity,
  observabilityIdentityQueryOptions,
} from "@repo/observability/identified-posthog";
import { isPostHogConfigured } from "@/lib/posthog/config";

/**
 * Attaches the caller's **server-derived** pseudonym to PostHog and Sentry.
 *
 * Replaces `SentryIdentityProvider`. The salt is API-only (`ENV_REFERENCE.md`);
 * this provider only ever *reads* `{ distinct_id, enabled, chapter_group_id }`
 * from `GET /v1/analytics/identity` and rejects anything that is not 64
 * lowercase hex. Auth-subject + chapter switches refetch: `chapter_group_id`
 * is a function of the active chapter, and a same-tab account swap must not
 * reuse another member's hex (`useViewerUserId` can lag on `["user","me"]`).
 * The query stays off until the auth uid is known — a first paint with
 * `useAuthUserId() === null` must not cache a JWT identity under `"none"`.
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
  const authUserId = useAuthUserId();
  const fetchEnabled =
    Boolean(authUserId) &&
    (Boolean(webSentryDsn()) || isPostHogConfigured());
  const { data } = useQuery(
    observabilityIdentityQueryOptions(
      authUserId,
      chapterId,
      () => client.GET("/v1/analytics/identity"),
      fetchEnabled,
    ),
  );

  useEffect(() => {
    applyFetchedObservabilityIdentity(fetchEnabled, data, Sentry.setUser);
  }, [data, fetchEnabled]);

  return <>{children}</>;
}
