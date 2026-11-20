"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { markLegalAcceptanceRecorded } from "./legal-acceptance";
import { inviteLongDate } from "./invite-card";
import type { components } from "@repo/api-sdk";

/**
 * One row of `GET /v1/invites` (#3607): who it went to (`email`, null for a
 * share link) and where it stands (`status`). `token` is there to build the
 * join link from; no client shows it.
 */
export type InviteListItem = components["schemas"]["InviteListItemDto"];
export type InviteStatus = components["schemas"]["InviteStatus"];

/** What each invite status reads as in a list: web's Invited and mobile's. */
export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  pending: "Pending",
  joined: "Joined",
  expired: "Expired",
  revoked: "Revoked",
};

/** Joined and expired invites stay listed this long, then drop off. */
const SETTLED_LIST_DAYS = 14;

/**
 * The invites worth listing: every pending one, and joined or expired ones
 * from the last two weeks. Revoked ones go: the officer chose to forget them.
 * Web's Invited list and mobile's Invite members screen both read this.
 */
export function listedInvites(
  rows: readonly InviteListItem[],
  now: Date = new Date(),
): InviteListItem[] {
  const cutoff = now.getTime() - SETTLED_LIST_DAYS * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    if (row.status === "revoked") return false;
    if (row.status === "pending") return true;
    return new Date(row.created_at).getTime() >= cutoff;
  });
}

/**
 * What can be done with a listed invite, in menu order (#3828):
 *
 * - `link`: copy or share its join link, while it is pending.
 * - `again`: email the address a fresh link, for an emailed invite nobody
 *   has joined with (pending or expired). The server retires the older
 *   invite once the new one is delivered.
 * - `revoke`: stop it working, while it is pending.
 *
 * Web's Invited menu and mobile's row menu both draw from this, so the two
 * apps offer the same actions on the same rows.
 */
export type InviteMenuAction = "link" | "again" | "revoke";

export function inviteMenuActions(
  invite: Pick<InviteListItem, "status" | "email">,
): InviteMenuAction[] {
  const actions: InviteMenuAction[] = [];
  if (invite.status === "pending") actions.push("link");
  if (
    invite.email &&
    (invite.status === "pending" || invite.status === "expired")
  ) {
    actions.push("again");
  }
  if (invite.status === "pending") actions.push("revoke");
  return actions;
}

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
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/invites", { signal });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    refetchInterval: options?.refetchInterval ?? false,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/**
 * The ids of the roles the caller may invite someone into
 * (`GET /v1/invites/roles`, #4546, #1830): ranked below them, holding only
 * permissions they hold, never the President's. Web's role picker offers only
 * these. Undefined until it loads, or if it fails; a picker then offers every
 * role and the API still refuses the rest.
 */
export function useInvitableRoleIds(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    // Outside the `["invites", chapterId]` prefix every invite write
    // invalidates: the answer depends on roles, not on invites.
    queryKey: ["invite-roles", chapterId],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/invites/roles", { signal });
      if (error) throw error;
      return data.role_ids;
    },
    staleTime: 60_000,
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
    mutationKey: ["invites", "create-invite"],
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

/**
 * The chapter links (#3353, Paul 2026-11-19: "One chapter link, 7 days"):
 * links an officer posts where the chapter will see them, such as its
 * Discord. Anyone who opens one joins at the role the officer picked for it
 * (#5633: "Officer picks it per link"), one live link per role, until it
 * expires or an officer turns it off (`useRevokeInvite`). Newest first; an
 * expired one comes back with `status: "expired"`. Under the
 * `["invites", chapterId]` prefix, so every invite write refreshes it.
 */
export function useChapterLinks(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["invites", chapterId, "chapter-link"],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/invites/chapter-link", {
        signal,
      });
      if (error) throw error;
      return data.links;
    },
    staleTime: 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/**
 * The line under the Chapter link label, on web's Invite members panel and
 * the phone's Invite members screen alike.
 */
export const CHAPTER_LINK_HINT =
  "Post a link in your group chat or Discord. Anyone with it joins at its role for 7 days.";

/**
 * A new chapter link for `role` (the chapter's default invite role when
 * left out); that role's link before it stops working at once, and other
 * roles' links are untouched (#5633).
 */
export function useCreateChapterLink() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["invites", "create-chapter-link"],
    mutationFn: async (input?: { role?: string }) => {
      const { data, error } = await client.POST("/v1/invites/chapter-link", {
        body: input?.role ? { role: input.role } : {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", chapterId] });
    },
  });
}

/**
 * When a chapter link stops working, in words, for the line under it:
 * "Works until Wednesday, November 26". Written out, as dates are across the
 * apps.
 */
export function chapterLinkExpiryLabel(
  link: Pick<InviteListItem, "status" | "expires_at">,
): string {
  const date = inviteLongDate(link.expires_at);
  return link.status === "expired" ? `Expired ${date}` : `Works until ${date}`;
}

export function useEmailInvites() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["invites", "email-invites"],
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
 * `accept_terms_privacy` is the join screen's Terms line (#2302, #5625):
 * every join from a screen showing it sends it, since tapping Join or a
 * Continue button under the line is the acceptance. Without it, a user who
 * hasn't accepted the current Terms is refused with a 403
 * (`isTermsRequiredError`), and the token stays usable.
 */
export function useRedeemInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["invites", "redeem-invite"],
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
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/invites/mine", { signal });
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * The invite card (#5625): the chapter's name, school, text mark and color,
 * who sent it, how many members it has, and whether the link still works
 * (`state`). Answers for a dead link too, so its card can still say whose
 * chapter it was and offer to ask for a new one. Needs no sign-in: it is what
 * a visitor sees before they have an account. Pass `null` for no invite yet.
 *
 * Not retried: a 404 is a link that never was an invite and stays one.
 * Keyed by the token, which is a secret, so it lives only in this query
 * cache. Replaces the signed-in `POST /v1/invites/preview` (#3352), which
 * stays on the API for builds already in people's hands.
 */
export function useInviteDetails(token: string | null) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["invite-details", token],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.POST("/v1/invites/details", {
        signal,
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

/**
 * "Ask Paul for a new link" on a dead invite's card (#5625): tells whoever
 * sent it, by name, that the signed-in caller wants a new one. A 409 means
 * the link works after all, or the caller is already in the chapter.
 */
export function useAskForNewLink() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["invites", "ask-for-new-link"],
    mutationFn: async (token: string) => {
      const { error } = await client.POST("/v1/invites/ask-for-new-link", {
        body: { token },
      });
      if (error) throw error;
    },
    onError: (_error, token) => {
      // The link's state may have changed under the card: read it again.
      void queryClient.invalidateQueries({
        queryKey: ["invite-details", token],
      });
    },
  });
}

export function useRevokeInvite() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["invites", "revoke-invite"],
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
