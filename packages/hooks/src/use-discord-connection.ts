"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { discordImportKeys } from "./use-discord-import";

/**
 * The Discord bot connection (admin only).
 *
 * This is the *second* way a chapter can get its history into Signet. The
 * first — uploading a DiscordChatExporter export — is untouched by any of this
 * and keeps working whether or not a Discord application is configured for the
 * environment. `useDiscordAvailability` is what tells the wizard which options
 * to offer, and its `false` is a normal answer, not an error.
 *
 * Nothing here ever handles a credential. Connecting produces a Discord URL to
 * send the admin to; what comes back is a guild id the API stores server-side.
 */

export const discordConnectionKeys = {
  all: ["discord-connection"] as const,
  availability: (chapterId: string | null) =>
    ["discord-connection", chapterId, "availability"] as const,
  connection: (chapterId: string | null) =>
    ["discord-connection", chapterId, "connection"] as const,
};

/**
 * Whether this environment has the Discord application configured at all.
 *
 * Cached hard: it is a deployment fact, not chapter state, and it cannot change
 * without a redeploy. Polling it would be pure noise on every wizard mount.
 */
export function useDiscordAvailability(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: discordConnectionKeys.availability(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/discord/availability");
      if (error) throw error;
      return data ?? { available: false };
    },
    enabled: !!chapterId && (options?.enabled ?? true),
    staleTime: 10 * 60_000,
    // A 403 (not an officer) will not fix itself by asking again on a timer.
    retry: false,
  });
}

export function useDiscordConnection(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: discordConnectionKeys.connection(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/discord/connection");
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && (options?.enabled ?? true),
    staleTime: 0,
    retry: false,
  });
}

/**
 * Start the "Add to Server" handshake.
 *
 * Returns the Discord URL; the caller navigates to it. Deliberately does NOT
 * navigate itself — a hook that redirects the whole browser as a side effect is
 * impossible to reason about from a call site, and the wizard wants to persist
 * its own state before leaving.
 */
export function useBeginDiscordConnect() {
  const client = useFrappClient();

  return useMutation({
    mutationFn: async (vars: { return_path?: string }) => {
      const { data, error } = await client.POST("/v1/discord/connect", {
        body: { return_path: vars.return_path },
      });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Activate the Discord server the OAuth callback parked.
 *
 * The callback links nothing by itself. It hands the browser a one-time token,
 * and this call — authenticated, and scoped to the active chapter — is what
 * binds the server. That is what stops an authorize URL completed by somebody
 * else's Discord admin from attaching their server to whoever generated it.
 */
export function useConfirmDiscordConnect() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: { handshake: string }) => {
      const { data, error } = await client.POST("/v1/discord/connect/confirm", {
        body: { handshake: vars.handshake },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: discordConnectionKeys.connection(chapterId),
      });
    },
  });
}

export function useDisconnectDiscord() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/v1/discord/connection");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: discordConnectionKeys.connection(chapterId),
      });
    },
  });
}

/** One channel or thread the scan found in the connected server. */
export interface DiscoveredDiscordChannel {
  id: string;
  discord_channel_id: string;
  discord_channel_name: string;
  discord_category: string | null;
  /**
   * Set when this row is a thread. The wizard lists only rows where this is
   * null — a thread follows its parent's destination rather than getting a
   * mapping question of its own.
   */
  parent_discord_channel_id: string | null;
  position: number;
}

export interface DiscordDiscoveryResult {
  channels: DiscoveredDiscordChannel[];
  roles: { discord_role_id: string; discord_role_name: string }[];
  /** What could not be enumerated. Shown to the admin, never swallowed. */
  warnings: string[];
}

/** Ask the API to scan the connected server and record what it finds. */
export function useDiscoverDiscordChannels() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: { id: string }) => {
      const { data, error } = await client.POST(
        "/v1/discord-imports/{id}/discover",
        { params: { path: { id: vars.id } } },
      );
      if (error) throw error;
      return data as unknown as DiscordDiscoveryResult;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.channels(chapterId, vars.id),
      });
    },
  });
}

/**
 * Record the admin's decision for each scanned channel.
 *
 * Only top-level channels are addressable. Threads take their parent's answer
 * server-side, and a channel the scan did not return is rejected rather than
 * added — so this cannot be used to name a channel the bot was never shown.
 */
export function useSetDiscoveredChannelMapping() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: {
      id: string;
      channels: {
        discord_channel_id: string;
        discord_channel_name: string;
        discord_category?: string;
        mapping_action: "create_new" | "use_existing" | "skip";
        target_channel_id?: string;
        new_channel_name?: string;
        new_channel_is_read_only: boolean;
        message_count?: number;
      }[];
    }) => {
      const { data, error } = await client.PUT(
        "/v1/discord-imports/{id}/discovered-channels",
        {
          params: { path: { id: vars.id } },
          body: { channels: vars.channels },
        },
      );
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.channels(chapterId, vars.id),
      });
    },
  });
}

/**
 * What the callback put on the URL, mapped to something an admin can read.
 *
 * The API sends back a CODE, never text — `error_description` is a string an
 * outside party can choose, and rendering supplied text inside the dashboard's
 * own chrome is a phishing surface even when React escapes it. The sentences
 * live here, where they are ours.
 */
export const DISCORD_CONNECT_MESSAGES: Record<
  string,
  { variant: "success" | "error"; message: string }
> = {
  connected: {
    variant: "success",
    message: "Discord connected. Signet can now read your server's history.",
  },
  pending: {
    variant: "error",
    message:
      "That Discord authorization could not be confirmed for this chapter. If you were connecting a different chapter, switch to it and try again.",
  },
  expired: {
    variant: "error",
    message:
      "That Discord connection link had expired or was already used. Start the connection again.",
  },
  declined: {
    variant: "error",
    message: "You cancelled the Discord authorization, so nothing was connected.",
  },
  invalid: {
    variant: "error",
    message: "Discord did not complete the authorization. Please try again.",
  },
  no_guild: {
    variant: "error",
    message:
      "No server was selected, so the Signet bot was not added anywhere. Choose a server on the Discord screen and authorize again.",
  },
  not_member: {
    variant: "error",
    message:
      "You are not a member of the server the bot was added to, so Signet could not confirm you administer it. Connect from an account that has Manage Server there.",
  },
  no_permission: {
    variant: "error",
    message:
      'You need the "Manage Server" permission in that Discord server to connect it to Signet. Ask a server admin to run this step.',
  },
  failed: {
    variant: "error",
    message: "Could not complete the Discord connection. Please try again.",
  },
};
