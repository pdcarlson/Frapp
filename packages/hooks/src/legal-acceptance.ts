"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { codeOf, serverMessageOf, statusOf } from "@repo/api-sdk";
import type { components } from "@repo/api-sdk";
import {
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
 * Query key for {@link useLegalAcceptance}, under the viewer's `["user", "me"]`.
 * The profile mutations match that key exactly (`PROFILE_QUERY_FILTERS`), so
 * an edit to the profile doesn't refetch this; accepting writes it directly.
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
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET(
        "/v1/users/me/legal-acceptance",
        { signal },
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
    mutationKey: ["user", "accept-legal-terms"],
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
 * The code `legal.acceptance_required` is checked first; it reaches clients
 * since #1020. The shared message is the fallback, for an API that predates
 * that and sends no code.
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
 * The redeem body for a join from a screen showing the Terms line (#5625).
 * The line ("By joining you agree to the Terms and Privacy Policy...",
 * `termsLine` in `@repo/validation`) replaced the checkbox the join screens
 * had (#2302) on Paul's 2026-11-19 pick, so the tap under it is the
 * acceptance and every such join carries it. The server records it only when
 * the user hasn't accepted the current version already.
 */
export function joinRedeemBody(
  token: string,
  /** The invite card's visit (#5663), so the join lands in its funnel. */
  visitId?: string | null,
): {
  token: string;
  accept_terms_privacy: true;
  visit_id?: string;
} {
  return {
    token,
    accept_terms_privacy: true,
    ...(visitId ? { visit_id: visitId } : {}),
  };
}
