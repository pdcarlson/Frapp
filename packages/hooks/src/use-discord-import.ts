"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Discord archive import (admin only).
 *
 * Every hook here takes `options.enabled` and defaults the query to disabled
 * until a chapter is known: the routes require `channels:manage`, so a mount
 * for an ordinary member would otherwise fire a guaranteed-403 that the query
 * client retries and refires on focus.
 */

export type DiscordImportStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "purging"
  | "purged";

/** Statuses the worker is actively moving. Only these are worth polling. */
export const DISCORD_IMPORT_ACTIVE_STATUSES: readonly DiscordImportStatus[] = [
  "ready",
  "running",
  "purging",
];

/**
 * How often the detail route is polled while an import is moving.
 *
 * The worker checkpoints roughly once a minute, so a shorter interval does not
 * surface progress sooner — but an import runs for minutes to tens of minutes
 * and a page that looks frozen for a minute reads as broken. Three seconds is
 * the compromise: cheap (one small row), and the bar visibly moves.
 *
 * Polling stops entirely on a terminal status, so an idle admin sitting on a
 * finished import costs nothing.
 */
export const DISCORD_IMPORT_POLL_MS = 3_000;

export const discordImportKeys = {
  all: ["discord-imports"] as const,
  list: (chapterId: string | null) =>
    ["discord-imports", chapterId, "list"] as const,
  detail: (chapterId: string | null, id: string) =>
    ["discord-imports", chapterId, "detail", id] as const,
  channels: (chapterId: string | null, id: string) =>
    ["discord-imports", chapterId, "channels", id] as const,
  files: (chapterId: string | null, id: string) =>
    ["discord-imports", chapterId, "files", id] as const,
};

export function useDiscordImports(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: discordImportKeys.list(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/discord-imports");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!chapterId && (options?.enabled ?? true),
    staleTime: 30_000,
  });
}

export function useDiscordImport(
  id: string | null,
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: discordImportKeys.detail(chapterId, id ?? ""),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/discord-imports/{id}", {
        params: { path: { id: id as string } },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && !!id && (options?.enabled ?? true),
    staleTime: 0,
    // A 403 (not an officer) or a 404 (purged elsewhere) will not fix itself by
    // asking again on a timer.
    retry: false,
    refetchInterval: (query) => {
      const status = (
        query.state.data as { status?: DiscordImportStatus } | undefined
      )?.status;
      return status && DISCORD_IMPORT_ACTIVE_STATUSES.includes(status)
        ? DISCORD_IMPORT_POLL_MS
        : false;
    },
  });
}

/**
 * The uploaded-file manifest for one import.
 *
 * Rows whose `uploaded_at` is null are what an interrupted upload still needs
 * to send — which is what makes re-picking the folder a resume rather than a
 * restart.
 */
export function useDiscordImportFiles(
  id: string | null,
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: discordImportKeys.files(chapterId, id ?? ""),
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/discord-imports/{id}/files",
        { params: { path: { id: id as string } } },
      );
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!chapterId && !!id && (options?.enabled ?? true),
    staleTime: 0,
    retry: false,
  });
}

/**
 * Stop a queued or running import.
 *
 * Not optional garnish: `DELETE` refuses while an import is `running` and tells
 * the admin to cancel first, so without this the documented recovery path has
 * no button behind it and a misconfigured import runs to completion.
 */
export function useCancelDiscordImport() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: { id: string }) => {
      const { data, error } = await client.POST(
        "/v1/discord-imports/{id}/cancel",
        { params: { path: { id: vars.id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.detail(chapterId, vars.id),
      });
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.list(chapterId),
      });
    },
  });
}

export function useCreateDiscordImport() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: {
      consent_acknowledged: boolean;
      guild_name?: string;
      /**
       * Which way in. `upload` is the DiscordChatExporter flow and stays the
       * default; `bot` reads the chapter's connected server directly.
       *
       * Required in the contract, not optional: the DTO declares a default, so
       * the generated type makes it non-optional — the same reason
       * `new_channel_is_read_only` is stated explicitly below. Defaulted here so
       * every existing caller keeps the phase-2 behaviour untouched.
       */
      source?: "upload" | "bot";
    }) => {
      const { data, error } = await client.POST("/v1/discord-imports", {
        body: { ...vars, source: vars.source ?? "upload" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.list(chapterId),
      });
    },
  });
}

export function useRequestDiscordUploadUrls() {
  const client = useFrappClient();

  return useMutation({
    mutationFn: async (vars: {
      id: string;
      files: {
        kind: "export" | "media";
        relative_path: string;
        content_type: string;
        byte_size: number;
        part_index?: number;
      }[];
    }) => {
      const { data, error } = await client.POST(
        "/v1/discord-imports/{id}/upload-urls",
        { params: { path: { id: vars.id } }, body: { files: vars.files } },
      );
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useConfirmDiscordUploads() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: { id: string; storage_paths: string[] }) => {
      const { data, error } = await client.POST(
        "/v1/discord-imports/{id}/uploads/confirm",
        {
          params: { path: { id: vars.id } },
          body: { storage_paths: vars.storage_paths },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.files(chapterId, vars.id),
      });
    },
  });
}

export function useSetDiscordChannelMapping() {
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
        // Required, not optional: the DTO declares a default, so the generated
        // contract type makes it non-optional. Callers state it explicitly.
        new_channel_is_read_only: boolean;
        message_count?: number;
      }[];
    }) => {
      const { data, error } = await client.PUT(
        "/v1/discord-imports/{id}/channels",
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

export function useSetDiscordRoleMapping() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: {
      id: string;
      roles: {
        discord_role_id: string;
        discord_role_name: string;
        signet_role_key: string;
      }[];
    }) => {
      const { data, error } = await client.PUT(
        "/v1/discord-imports/{id}/roles",
        { params: { path: { id: vars.id } }, body: { roles: vars.roles } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.detail(chapterId, vars.id),
      });
    },
  });
}

export function useStartDiscordImport() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: { id: string }) => {
      const { data, error } = await client.POST(
        "/v1/discord-imports/{id}/start",
        { params: { path: { id: vars.id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.detail(chapterId, vars.id),
      });
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.list(chapterId),
      });
    },
  });
}

export function useDeleteDiscordImport() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (vars: { id: string }) => {
      const { data, error } = await client.DELETE("/v1/discord-imports/{id}", {
        params: { path: { id: vars.id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.detail(chapterId, vars.id),
      });
      void queryClient.invalidateQueries({
        queryKey: discordImportKeys.list(chapterId),
      });
    },
  });
}
