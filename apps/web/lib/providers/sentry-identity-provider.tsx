"use client";

import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import * as Sentry from "@sentry/nextjs";
import { webSentryDsn } from "@/lib/sentry/options";

/**
 * Attaches the caller's **server-derived** pseudonym to Sentry events (#865).
 *
 * This is the resolution of the issue's client-salt question, and the reasoning
 * belongs next to the code:
 *
 * The API's pseudonyms are `hmac_sha256(ANALYTICS_HMAC_SALT, user_id)`, and that
 * salt is API-only on purpose — `ENV_REFERENCE.md` is explicit that putting it in
 * a client bundle would let the dataset be rainbow-tabled back to raw user ids.
 * So the browser cannot compute a pseudonym. The two options were to drop
 * identifiers client-side entirely, or to fetch the already-hashed value from the
 * server. This takes the second, because the wiring turned out to be almost free:
 * `GET /v1/analytics/identity` already exists for exactly this purpose (it is how
 * the analytics client attributes events without holding the salt), it is already
 * in the generated SDK types, and this app already mounts an authenticated
 * client.
 *
 * What that buys: a web error is attributable to a tenant, and the digest is
 * byte-identical to the one the API puts on its own events — so one user's
 * browser error and their server error correlate across the two Sentry projects.
 * The salt never leaves the API.
 *
 * What it deliberately does not do: chapter ids get no client pseudonym, because
 * no endpoint returns one. They are dropped rather than sent raw. Free-text
 * identifiers in the browser are likewise redacted to `[redacted:id]` rather than
 * hashed — the shared scrubber's existing fail-closed branch, taken here by
 * passing `NO_PSEUDONYMS` in `lib/sentry/options.ts`.
 *
 * The id is only ever *read* from the server; the scrubber independently
 * re-checks it against `/^[0-9a-f]{64}$/` before letting it onto an event, so a
 * malformed or unexpected response cannot put a raw identifier on a report.
 */
export function SentryIdentityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useFrappClient();
  // With no DSN, Sentry was never initialized — so skip the request entirely
  // rather than fetching an identity nothing will consume.
  const enabled = Boolean(webSentryDsn());

  const { data } = useQuery({
    queryKey: ["sentry-identity"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/analytics/identity");
      if (error) throw error;
      return data ?? null;
    },
    enabled,
    // The pseudonym is a pure function of the user id and the environment salt,
    // so it does not change for the life of the session. Refetching it would be
    // a request per window focus for a value that cannot have moved.
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!enabled) return;
    // `enabled: false` from the API means no analytics key is configured there;
    // treat it exactly like an absent id rather than attaching something the
    // server itself considers unusable.
    const distinctId =
      data && data.enabled && typeof data.distinct_id === "string"
        ? data.distinct_id
        : null;
    Sentry.setUser(distinctId ? { id: distinctId } : null);
  }, [data, enabled]);

  return <>{children}</>;
}
