"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * A member linking their own Discord account in the active chapter, so the
 * chapter's imported Discord history they wrote shows as theirs (#2878).
 *
 * Any member, not officers only: the account is proved with Discord's own
 * sign-in, and no route links anyone but the caller. Linking and unlinking
 * change `sender_id` on imported messages server-side; imported rows never
 * arrive over Realtime, so a chat thread already in the cache shows the change
 * only on its next read. The caller decides what to drop, because this package
 * does not own the chat message cache (`@repo/chat-core`).
 */

export const discordAuthorLinkKeys = {
  all: ["discord-author-link"] as const,
  mine: (chapterId: string | null) =>
    ["discord-author-link", chapterId, "mine"] as const,
  chapter: (chapterId: string | null) =>
    ["discord-author-link", chapterId, "chapter"] as const,
};

/** The caller's link in the active chapter, plus whether linking is offered. */
export function useDiscordAuthorLink(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: discordAuthorLinkKeys.mine(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/discord/author-link");
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && (options?.enabled ?? true),
    staleTime: 60_000,
  });
}

/**
 * The active chapter's Discord id → member map, for linking a Discord user
 * mention in imported text to the member it names (#2875).
 */
export function useDiscordAuthorLinks(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: discordAuthorLinkKeys.chapter(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/discord/author-links");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!chapterId && (options?.enabled ?? true),
    staleTime: 5 * 60_000,
  });
}

/**
 * Start linking. Returns Discord's authorize URL; the caller navigates to it.
 * Discord brings the browser back to `/profile?discord=…&handshake=…`.
 */
export function useBeginDiscordAuthorLink() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.POST(
        "/v1/discord/author-link/start",
      );
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Spend the one-time token the callback put on the redirect. It links only for
 * the member who started the handshake, in the chapter it was started in.
 */
export function useConfirmDiscordAuthorLink() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: { handshake: string }) => {
      const { data, error } = await client.POST(
        "/v1/discord/author-link/confirm",
        { body: { handshake: vars.handshake } },
      );
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: discordAuthorLinkKeys.mine(chapterId),
      });
      void queryClient.invalidateQueries({
        queryKey: discordAuthorLinkKeys.chapter(chapterId),
      });
    },
  });
}

export function useUnlinkDiscordAuthor() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/v1/discord/author-link");
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: discordAuthorLinkKeys.mine(chapterId),
      });
      void queryClient.invalidateQueries({
        queryKey: discordAuthorLinkKeys.chapter(chapterId),
      });
    },
  });
}
