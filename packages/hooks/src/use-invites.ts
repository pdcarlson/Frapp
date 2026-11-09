"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { markLegalAcceptanceRecorded } from "./legal-acceptance";
import type { components } from "@repo/api-sdk";

/**
 * One row of `GET /v1/invites` (#3607): who it went to (`email`, null for a
 * share link) and where it stands (`status`). `token` is there to build the
 * join link from; no client shows it.
 */
export type InviteListItem = components["schemas"]["InviteListItemDto"];
export type InviteStatus = components["schemas"]["InviteStatus"];

/**
 * `refetchInterval` is for a screen that watches its invites get used while
 * it is open, such as mobile setup's invite step, which marks a shared link
 * Joined. Off by default.
 */
export function useInvites(options?: {
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["invites", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invites");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    refetchInterval: options?.refetchInterval ?? false,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/**
 * `role` is optional on every create route (#422). Omitting it makes the
 * API resolve the chapter's configured default invite role, then the seeded
 * Member role. Typed optional here so a caller can actually express "use the
 * chapter default" — a required `role` would leave that server-side path
 * unreachable from every shipped surface.
 */
export function useCreateInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { role?: string }) => {
      const { data, error } = await client.POST("/v1/invites", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
    },
  });
}

export function useEmailInvites() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { role?: string; emails: string[] }) => {
      const { data, error } = await client.POST("/v1/invites/email", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
    },
  });
}

/**
 * Join a chapter with an invite token.
 *
 * `accept_terms_privacy` is the join screen's Terms checkbox (#2302);
 * `useJoinTermsCheckbox` decides when to send it. Without it, a user who hasn't
 * accepted the current Terms is refused with a 403 (`isTermsRequiredError`),
 * and the token stays usable.
 */
export function useRedeemInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      token: string;
      accept_terms_privacy?: true;
    }) => {
      const { data, error } = await client.POST("/v1/invites/redeem", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, body) => {
      if (body.accept_terms_privacy) markLegalAcceptanceRecorded(queryClient);
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
    },
    // On failure too: an offered invite the redeem finds dead (410) or
    // already joined (409) must leave the offers, not stay on as a card
    // that fails again (#3782).
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    },
  });
}

/**
 * The invites waiting for the signed-in account (#3776): every pending invite
 * emailed to the address Auth verified for it, minus chapters it already
 * belongs to, each with the preview card's facts and the token to redeem.
 * The API reads the address from the account, never from the client, so an
 * unverified account gets an empty list.
 *
 * Pass the signed-in user's id, or `null` before the session is known. Keyed
 * by it, so a second account in the same tab never sees the first one's
 * invites from the cache. Not retried: no answer just means no offer, and the
 * pasted-invite form still works.
 */
export function usePendingInvites(userId: string | null) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["pending-invites", userId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invites/mine");
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * What an invite is for, read without using it up (#3352): the chapter's name,
 * school, text mark and color, who sent it and the role it grants. The join
 * screen's confirm card shows it before the member taps Join. Pass `null` for
 * no invite yet.
 *
 * Not retried: a 410 is a dead link and stays one, and anything else leaves
 * the card showing the bare invite, which can still be joined. Keyed by the
 * token, which is a secret, so it lives only in this query cache.
 */
export function useInvitePreview(token: string | null) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async () => {
      const { data, error } = await client.POST("/v1/invites/preview", {
        body: { token: token as string },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!token,
    retry: false,
    staleTime: 60_000,
  });
}

export function useRevokeInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/invites/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
    },
  });
}
