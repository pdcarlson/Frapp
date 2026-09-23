"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { markLegalAcceptanceRecorded } from "./legal-acceptance";

export function useInvites() {
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
    enabled: !!chapterId,
  });
}

/**
 * `role` is optional on all three create routes (#422). Omitting it makes the
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

export function useBatchCreateInvites() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { role?: string; count: number }) => {
      const { data, error } = await client.POST("/v1/invites/batch", { body });
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
    mutationFn: async (body: { token: string; accept_terms_privacy?: true }) => {
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
