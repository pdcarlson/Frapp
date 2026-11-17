import { throwUnlessOk } from "@repo/api-sdk";
import type { components } from "@repo/api-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The chapter's connected Google Drive folder (#5157): Frapp copies its files
 * into Documents and keeps them matching it. Behavior:
 * `spec/behavior/chapter-docs.md` § Google Drive folder.
 */
const googleDriveKeys = createChapterQueryKeys("google-drive");

export type GoogleDriveStatus = components["schemas"]["GoogleDriveStatusDto"];

/** How often the status is re-read while a sync is due or running. */
const SYNCING_POLL_MS = 4_000;

/**
 * The chapter's Drive folder. While a sync is due or running it is re-read
 * every few seconds, and when one finishes the document list is refreshed,
 * so the files appear without a reload.
 */
export function useGoogleDriveStatus(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: googleDriveKeys.chapter(chapterId!),
    queryFn: async ({ signal }): Promise<GoogleDriveStatus> => {
      const result = await client.GET("/v1/google-drive", { signal });
      throwUnlessOk(result);
      return result.data!;
    },
    staleTime: 60_000,
    enabled: (options.enabled ?? true) && !!chapterId,
    refetchInterval: (q) =>
      q.state.data?.connection?.syncing ? SYNCING_POLL_MS : false,
  });

  const syncing = query.data?.connection?.syncing ?? false;
  const lastSynced = query.data?.connection?.last_synced_at ?? null;
  const seen = useRef<{ syncing: boolean; lastSynced: string | null } | null>(
    null,
  );
  useEffect(() => {
    const before = seen.current;
    seen.current = { syncing, lastSynced };
    if (!before) return;
    // A pass finished (or one ran between reads): the list has new copies.
    if ((before.syncing && !syncing) || before.lastSynced !== lastSynced) {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["document-previews"] });
    }
  }, [syncing, lastSynced, queryClient]);

  return query;
}

function useStatusWriter() {
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return (status: GoogleDriveStatus) => {
    if (chapterId) {
      queryClient.setQueryData(googleDriveKeys.chapter(chapterId), status);
    }
  };
}

/**
 * Connect the folder a Drive link names, with who sees what it brings in
 * (#5220; `null` is everyone who can open Documents). Refused with a reason
 * to show.
 */
export function useConnectGoogleDrive() {
  const client = useFrappClient();
  const write = useStatusWriter();
  return useMutation({
    mutationKey: ["google-drive", "connect"],
    mutationFn: async ({
      folderLink,
      whoCanSee,
    }: {
      folderLink: string;
      whoCanSee: string[] | null;
    }): Promise<GoogleDriveStatus> => {
      const result = await client.PUT("/v1/google-drive", {
        body: {
          folder_link: folderLink,
          ...(whoCanSee !== null ? { who_can_see: whoCanSee } : {}),
        },
      });
      throwUnlessOk(result);
      return result.data!;
    },
    onSuccess: write,
  });
}

/** Sync the connected folder now. */
export function useSyncGoogleDrive() {
  const client = useFrappClient();
  const write = useStatusWriter();
  return useMutation({
    mutationKey: ["google-drive", "sync"],
    mutationFn: async (): Promise<GoogleDriveStatus> => {
      const result = await client.POST("/v1/google-drive/sync");
      throwUnlessOk(result);
      return result.data!;
    },
    onSuccess: write,
  });
}

/** Disconnect the folder; its copies leave Documents within a minute. */
export function useDisconnectGoogleDrive() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["google-drive", "disconnect"],
    mutationFn: async (): Promise<void> => {
      const result = await client.DELETE("/v1/google-drive");
      throwUnlessOk(result);
    },
    onSuccess: () => {
      if (!chapterId) return;
      queryClient.setQueryData<GoogleDriveStatus>(
        googleDriveKeys.chapter(chapterId),
        (current) => ({
          available: current?.available ?? true,
          service_account_email: current?.service_account_email ?? null,
          connection: null,
        }),
      );
      // The worker removes the copies on its next tick.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["documents"] });
      }, 70_000);
    },
  });
}

/**
 * Move a Drive copy that sync held back (#5220) into the folder Drive put it
 * in, so everyone who sees that folder sees it.
 */
export function useOpenUpDriveCopy() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["google-drive", "open-up"],
    mutationFn: async (id: string): Promise<void> => {
      const result = await client.POST("/v1/google-drive/copies/{id}/open-up", {
        params: { path: { id } },
      });
      throwUnlessOk(result);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
