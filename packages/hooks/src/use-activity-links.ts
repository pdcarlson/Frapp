"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Activity, ActivityLink } from "./activity-rows";
import { activityKeys } from "./use-activity";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Take one link off the cached read so its row leaves the page the moment
 * the member acts, before the server answers. Returns the link and where it
 * sat, so a failure can put back exactly that row (not a whole snapshot,
 * which would undo a second action the member took meanwhile).
 */
function dropLink(
  activity: Activity | undefined,
  id: string,
): { next: Activity; link: ActivityLink; index: number } | null {
  if (!activity) return null;
  const index = activity.links.findIndex((link) => link.id === id);
  if (index === -1) return null;
  return {
    next: {
      ...activity,
      links: activity.links.filter((link) => link.id !== id),
    },
    link: activity.links[index]!,
    index,
  };
}

function restoreLink(
  activity: Activity | undefined,
  link: ActivityLink,
  index: number,
): Activity | undefined {
  if (!activity || activity.links.some((row) => row.id === link.id)) {
    return activity;
  }
  const links = [...activity.links];
  links.splice(Math.min(index, links.length), 0, link);
  return { ...activity, links };
}

/**
 * The shared shape of the four link writes (`spec/behavior/activity.md`
 * § Links). The two that take a link off the list (a state, a removal) drop
 * its row optimistically and put it back on failure; the two that undo one
 * (clear, restore) wait for the re-read, since only the server has the row's
 * current fields. Activity is re-read when the last pending link write
 * settles: a read that started while another write was still on its way
 * would bring that write's dropped row back until its own re-read.
 *
 * Callers react to each write through `mutateAsync`'s promise, never through
 * per-call `mutate(id, { onSuccess })` options, which TanStack Query drops for
 * an earlier call when the same hook writes again (two quick Dones).
 */
function useLinkWrite(
  name: string,
  write: (id: string) => Promise<void>,
  drops: boolean,
) {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    // A literal root, as every mutation key has (`mutation-keys.spec.ts`);
    // `onSettled` counts pending link writes by it.
    mutationKey: ["activity-link-write", name],
    mutationFn: write,
    onMutate: async (id: string) => {
      if (!drops || !chapterId) return null;
      const queryKey = activityKeys.chapter(chapterId);
      // A read already in flight has not seen this write; landing after the
      // drop it would bring the row back.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const dropped = dropLink(
        queryClient.getQueryData<Activity>(queryKey),
        id,
      );
      if (!dropped) return null;
      queryClient.setQueryData(queryKey, dropped.next);
      return { queryKey, link: dropped.link, index: dropped.index };
    },
    onError: (_error, _id, context) => {
      if (!context) return;
      queryClient.setQueryData<Activity>(context.queryKey, (current) =>
        restoreLink(current, context.link, context.index),
      );
    },
    onSettled: () => {
      if (!chapterId) return;
      // This write still counts as pending here; any more are still on
      // their way, and the last of them re-reads.
      if (queryClient.isMutating({ mutationKey: ["activity-link-write"] }) > 1)
        return;
      void queryClient.invalidateQueries({
        queryKey: activityKeys.chapter(chapterId),
        exact: true,
      });
    },
  });
}

/** Done (`done`: they filled it in) or Hide (`hidden`: not for them). Per member. */
export function useSetActivityLinkState(state: "done" | "hidden") {
  const client = useFrappClient();
  return useLinkWrite(
    `link-${state}`,
    async (id) => {
      const { error } = await client.PUT("/v1/activity/links/{id}/state", {
        params: { path: { id } },
        body: { state },
      });
      if (error) throw error;
    },
    true,
  );
}

/** Undo Done or Hide: the link is back on the member's own list. */
export function useClearActivityLinkState() {
  const client = useFrappClient();
  return useLinkWrite(
    "link-clear",
    async (id) => {
      const { error } = await client.DELETE("/v1/activity/links/{id}/state", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    false,
  );
}

/** Officer remove (`channels:manage`): off everyone's Activity; chat keeps the message. */
export function useRemoveActivityLink() {
  const client = useFrappClient();
  return useLinkWrite(
    "link-remove",
    async (id) => {
      const { error } = await client.PUT("/v1/activity/links/{id}/removed", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    true,
  );
}

/** Undo an officer remove. */
export function useRestoreActivityLink() {
  const client = useFrappClient();
  return useLinkWrite(
    "link-restore",
    async (id) => {
      const { error } = await client.DELETE("/v1/activity/links/{id}/removed", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    false,
  );
}
