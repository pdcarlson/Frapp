"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { codeOf, serverMessageOf, statusOf } from "@repo/api-sdk";
import type { components } from "@repo/api-sdk";
import {
  JOIN_TERMS_REQUIRED_COPY,
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  TERMS_PROMPT_COPY,
} from "@repo/validation";
import { useFrappClient } from "./use-frapp-client";

/**
 * The Terms of Service and Privacy Policy acceptance, for both apps (#2302).
 * The rule and the record are `spec/behavior/legal.md` § Acceptance record;
 * this module is everything a client needs to follow it, kept in one place so
 * web and mobile can't drift apart on when to ask.
 */

/** Where the viewer stands against the Terms the server enforces now (#2302). */
export type LegalAcceptance = components["schemas"]["LegalAcceptanceDto"];

/**
 * Query key for {@link useLegalAcceptance}. Under `["user", "me"]`, so
 * `useUpdateUser`'s invalidation refreshes it too.
 */
export const legalAcceptanceQueryKey = () =>
  ["user", "me", "legal-acceptance"] as const;

/**
 * Whether the viewer has accepted the Terms of Service and Privacy Policy
 * version the server enforces (#2302).
 *
 * Show the prompt on `data.required`, never by comparing versions: a store
 * binary can't be updated over the air, so one compiled against an older
 * `LEGAL_POLICY_VERSION` would disagree with the server forever. Needs no
 * chapter, because a user is asked before they join one.
 */
export function useLegalAcceptance(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  return useQuery({
    queryKey: legalAcceptanceQueryKey(),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/users/me/legal-acceptance",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Mark the cached status accepted after a request that recorded the
 * acceptance server-side: the Terms prompt, a join with the box ticked, or
 * the create-chapter wizard.
 *
 * Written straight into the cache rather than only invalidated. Those
 * requests also refresh the viewer's memberships, and a gate that saw the new
 * membership before the refetched status would flash the Terms prompt at
 * someone who ticked the box a moment ago. The invalidation that follows
 * still reads the server's answer.
 */
export function markLegalAcceptanceRecorded(queryClient: QueryClient): void {
  queryClient.setQueryData<LegalAcceptance>(legalAcceptanceQueryKey(), (old) =>
    old
      ? {
          ...old,
          accepted_version: old.current_version,
          accepted_at: old.accepted_at ?? new Date().toISOString(),
          required: false,
        }
      : old,
  );
  void queryClient.invalidateQueries({ queryKey: legalAcceptanceQueryKey() });
}

/**
 * Accept the current Terms of Service and Privacy Policy (#2302). The server
 * records the version and time; the body only says the box was ticked.
 */
export function useAcceptLegalTerms() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.POST(
        "/v1/users/me/legal-acceptance",
        { body: { accept_terms_privacy: true } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(legalAcceptanceQueryKey(), data);
    },
  });
}

/**
 * True when the server refused a join or a chapter creation because the caller
 * hasn't accepted the current Terms (#2302).
 *
 * The API throws `code: legal.acceptance_required`, but `AllExceptionsFilter`
 * sends clients only `statusCode`, `error`, `message` and `requestId` (#1020),
 * so the code never arrives today. The shared message is what identifies it; the
 * code is checked first so this keeps working once #1020 exposes codes.
 */
export function isTermsRequiredError(error: unknown): boolean {
  if (codeOf(error) === LEGAL_ACCEPTANCE_REQUIRED_CODE) return true;
  return (
    statusOf(error) === 403 &&
    serverMessageOf(error) === LEGAL_ACCEPTANCE_REQUIRED_MESSAGE
  );
}

/** The Terms prompt's copy for an acceptance the server didn't record. */
export function termsPromptErrorCopy(error: unknown): string {
  return statusOf(error) === 410
    ? TERMS_PROMPT_COPY.deleted
    : TERMS_PROMPT_COPY.failed;
}

/**
 * The join screens' Terms checkbox (#2302), shared by web `/join` and mobile
 * s02 so the rule for when to ask lives once.
 *
 * - **When to ask.** Unless the server has said this user already accepted
 *   the current Terms. A status still loading, or one that failed, asks:
 *   ticking is harmless for someone who had accepted, and leaving the box off
 *   would only earn a refusal.
 * - **A refusal asks again.** If the server refuses the join anyway (its
 *   answer changed since the status was read), `onJoinError` shows the box
 *   and clears any stale tick.
 */
export function useJoinTermsCheckbox(options: { enabled: boolean }) {
  const status = useLegalAcceptance({ enabled: options.enabled });
  const [accepted, setAccepted] = useState(false);
  const [demanded, setDemanded] = useState(false);
  const needed = demanded || status.data?.required !== false;
  return {
    /** Show the checkbox. */
    needed,
    accepted,
    setAccepted,
    /** The copy to show instead of joining, or `null` when the join may go ahead. */
    blocker: needed && !accepted ? JOIN_TERMS_REQUIRED_COPY : null,
    /** The redeem body: the checkbox goes with it whenever it is shown. */
    redeemBody(token: string): { token: string; accept_terms_privacy?: true } {
      return needed ? { token, accept_terms_privacy: true } : { token };
    },
    /** Hand a failed join's error here; it asks again if the server wanted the box. */
    onJoinError(error: unknown): void {
      if (!isTermsRequiredError(error)) return;
      setDemanded(true);
      setAccepted(false);
    },
  };
}
