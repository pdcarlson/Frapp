"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { withHereMention } from "@repo/validation";

/**
 * Role write bodies, read from the contract rather than restated: `color` is a
 * palette enum there (#3485), which a hand-written `string` would hide until
 * the API refused the request.
 */
export type CreateRoleBody = components["schemas"]["CreateRoleDto"];
export type UpdateRoleBody = components["schemas"]["UpdateRoleDto"];

export function useRoles() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/roles");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export function usePermissionsCatalog() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId, "permissions-catalog"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/roles/permissions-catalog");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: !!chapterId,
  });
}

export function useCreateRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["roles", "create-role"],
    mutationFn: async (body: CreateRoleBody) => {
      const { data, error } = await client.POST("/v1/roles", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
    },
  });
}

export function useUpdateRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["roles", "update-role"],
    mutationFn: async ({ id, body }: { id: string; body: UpdateRoleBody }) => {
      const { data, error } = await client.PATCH("/v1/roles/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
      // The roster's `role_color` is computed from role colors and order
      // (#3485), so a role edit or delete repaints chat names now, not after
      // the roster's 60s staleTime.
      queryClient.invalidateQueries({
        queryKey: ["members", chapterId, "roster"],
      });
      // A role's permissions decide who reads a ROLE_GATED channel, and its
      // order ranks the channel member list (#3536).
      queryClient.invalidateQueries({
        queryKey: ["members", chapterId, "channel"],
      });
    },
  });
}

export function useDeleteRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["roles", "delete-role"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/roles/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
      // Every members query (#4547): the delete takes the role off its
      // holders' `role_ids` and may give them Everyone, so the Members list
      // must not keep sending the deleted id back (the API refuses an id that
      // names no role and the member no longer holds). The prefix also covers
      // the roster, whose `role_color` comes from role colors and order
      // (#3485), and the channel member list a role's permissions gate (#3536).
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      // Deleting a role can clear `chapters.default_invite_role_id` server-side
      // via `on delete set null` (#422). The config query has a 5-minute
      // staleTime, so without this the Settings card keeps showing the deleted
      // id and warns that the default "no longer exists" — about a setting the
      // server has already nulled.
      queryClient.invalidateQueries({
        queryKey: ["chapter-config", chapterId],
      });
    },
  });
}

export function useTransferPresidency() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["roles", "transfer-presidency"],
    mutationFn: async (body: { target_member_id: string }) => {
      const { data, error } = await client.POST(
        "/v1/roles/transfer-presidency",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}

/**
 * Whether the caller may claim the chapter's vacant presidency right now
 * (spec/behavior/rbac.md § Presidency Transfer "Edge case"). Callers should
 * pass `enabled: false` until the current chapter's `needs_president` flag
 * (from `useCurrentChapter`) is true — every member holds `members:view`, so
 * this would otherwise poll on every Roles page visit for the common case
 * where no chapter needs a new President.
 */
export function usePresidencyClaimStatus(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId, "presidency-claim-status"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/roles/presidency-claim-status",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
    enabled: !!chapterId && (options?.enabled ?? true),
  });
}

export function useClaimPresidency() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["roles", "claim-presidency"],
    mutationFn: async () => {
      const { data, error } = await client.POST(
        "/v1/roles/claim-presidency",
        {},
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      queryClient.invalidateQueries({
        queryKey: ["chapters", "current", chapterId],
      });
    },
  });
}

/** A role as the caller's `@`-mention picker offers it. */
export type ChatMentionRole = components["schemas"]["MentionRoleDto"];

/**
 * The chapter roles the caller may `@`, for both composers' mention pickers
 * (2026-11-06, `GET /v1/channels/mention-roles`). Each says whether the caller
 * may ping it: the server decides, and the same rule decides who a sent
 * `@Role` reaches, so the picker never offers a ping that would land on
 * nobody. Membership is not sent; the server expands the role on send.
 *
 * `@here` rides after `@everyone` (`withHereMention`, 2026-11-12): it is no
 * role, so the API leaves it out, and it follows `@everyone`'s switch, which
 * is the rule the server applies when the message lands.
 *
 * Keyed under `["roles", chapterId, …]` so the role mutations, which
 * invalidate `["roles", chapterId]`, refresh it. A member's role changing
 * elsewhere is caught by the minute's staleness, as the roster is.
 */
export function useMentionRoles() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId, "mention-roles"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/mention-roles");
      if (error) throw error;
      return withHereMention(data);
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}
