"use client";

import { useCallback, useEffect, useRef } from "react";
import type { InviteFunnelStepInput } from "@repo/validation";
import { useFrappClient } from "./use-frapp-client";

/** Records one step of the invite card funnel. Never throws. */
export type RecordInviteStep = (input: InviteFunnelStepInput) => void;

/**
 * The invite card funnel (#5663), shared by web `/join` and the phone's join
 * screen so both report the same steps the same way: each step posts to
 * `POST /v1/invites/funnel` with the invite token and the card's visit id,
 * and the API records it under the invite's chapter, opt-out applied
 * (`invite-funnel.ts` in `@repo/validation` says why it isn't
 * `POST /v1/analytics/events`).
 *
 * The visit id is each app's own, because where it lives differs: the web
 * keeps it in the tab's session storage so a sign-in that leaves for Apple or
 * Google and comes back is still the same visit, the phone keeps it in memory
 * for the native sign-ins that never leave the app. Both mint it as a random
 * UUID. With no token or no visit id, nothing is sent.
 *
 * Fire-and-forget: a lost step never reaches the screen.
 */
export function useInviteFunnel(
  token: string | null,
  visitId: string | null,
): RecordInviteStep {
  const client = useFrappClient();
  return useCallback<RecordInviteStep>(
    (input) => {
      if (!token || !visitId) return;
      void client
        .POST("/v1/invites/funnel", {
          body: { token, visit_id: visitId, ...input },
        })
        .catch(() => undefined);
    },
    [client, token, visitId],
  );
}

/**
 * Records `card-viewed` once for each state the card shows a visit in: the
 * first look, again signed in after a sign-in, and a link that died while it
 * was open. A re-render or a refetch with the same answer sends nothing
 * more.
 */
export function useInviteCardViewed(
  record: RecordInviteStep,
  view: Pick<InviteFunnelStepInput, "state" | "signed_in"> | null,
): void {
  const sent = useRef<string | null>(null);
  const state = view?.state;
  const signedIn = view?.signed_in;
  useEffect(() => {
    if (!state || signedIn === undefined) return;
    const key = `${state}:${signedIn}`;
    if (sent.current === key) return;
    sent.current = key;
    record({ step: "card-viewed", state, signed_in: signedIn });
  }, [record, signedIn, state]);
}
