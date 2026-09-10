import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "@repo/hooks";
import * as Sentry from "@sentry/react-native";
import { useAuthSession } from "@/lib/auth-session";
import { mobileSentryDsn } from "@/lib/sentry/options";
import {
  applyFetchedObservabilityIdentity,
  observabilityIdentityQueryOptions,
} from "@repo/observability/identified-posthog";
import { isPostHogConfigured } from "@/lib/posthog/config";

/**
 * Mobile identity attach. Same `GET /v1/analytics/identity` hex as web, but
 * this provider also sits above the auth screens, so the request waits until
 * `useAuthSession` is `authenticated`.
 *
 * Salt stays API-only. Opt-out still identifies (opt-in needs no refetch) and
 * still sets Sentry `user.id`. `enabled: false` means analytics is unconfigured.
 */
export function ObservabilityIdentityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = useAuthSession();
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const vendorsOn = Boolean(mobileSentryDsn()) || isPostHogConfigured();
  const canFetch = session.status === "authenticated" && vendorsOn;
  const query = useQuery(
    observabilityIdentityQueryOptions(
      chapterId,
      () => client.GET("/v1/analytics/identity"),
      canFetch,
    ),
  );

  useEffect(() => {
    applyFetchedObservabilityIdentity(canFetch, query.data, Sentry.setUser);
  }, [canFetch, query.data]);

  return <>{children}</>;
}
