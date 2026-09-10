import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "@repo/hooks";
import * as Sentry from "@sentry/react-native";
import { useAuthSession } from "@/lib/auth-session";
import { mobileSentryDsn } from "@/lib/sentry/options";
import {
  applyObservabilityIdentity,
  fetchAnalyticsIdentity,
} from "@repo/observability/identified-posthog";
import { isPostHogConfigured } from "@/lib/posthog/config";

/**
 * Attaches the caller's **server-derived** HMAC hex to PostHog RN and Sentry.
 *
 * Auth-gated: this provider wraps signed-in tabs *and* the auth stack, so
 * `GET /v1/analytics/identity` waits until `status === "authenticated"`. Web
 * does not need that gate (its tree is already behind the session).
 *
 * The salt is API-only (`ENV_REFERENCE.md`). Anything that is not 64
 * lowercase hex is dropped. Chapter switches refetch because
 * `chapter_group_id` is a function of the active chapter.
 *
 * Opt-out still identifies (so opt-in does not need a refetch) and still sets
 * Sentry `user.id`. `enabled: false` from the API means analytics is
 * unconfigured, not the same as opt-out.
 */
export function ObservabilityIdentityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = useAuthSession();
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const vendorsLive = Boolean(mobileSentryDsn()) || isPostHogConfigured();
  const canFetchIdentity =
    session.status === "authenticated" && vendorsLive;

  const identityQuery = useQuery({
    queryKey: ["mobile-observability-identity", chapterId ?? "none"],
    queryFn: () =>
      fetchAnalyticsIdentity(() => client.GET("/v1/analytics/identity")),
    enabled: canFetchIdentity,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });

  useEffect(() => {
    if (!canFetchIdentity || identityQuery.data === undefined) {
      return;
    }
    applyObservabilityIdentity(identityQuery.data, Sentry.setUser);
  }, [canFetchIdentity, identityQuery.data]);

  return <>{children}</>;
}
