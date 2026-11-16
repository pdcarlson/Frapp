"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EventAgendaItem, EventAttachment } from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import type { components } from "@repo/api-sdk";

/**
 * What a save of one meeting's own lists sends (#4934): the agenda, the
 * attachments, or both, each whole. Always the occurrence itself, never
 * `scope: "series"`: each meeting keeps its own (`spec/behavior/events.md`
 * § Agenda and attachments).
 */
export interface EventListsPatch {
  agenda?: EventAgendaItem[];
  attachments?: EventAttachment[];
}

/**
 * Save an event's agenda or attachments, both apps' one write for them.
 *
 * Optimistic on the event's own read (`["events", chapterId, id]`, what
 * `useEvent` holds): a check-off lands at once, the way Notion's and
 * Fellow's agenda checkboxes do, and a refused save puts the read back. The
 * chapter's event list is refetched after, since a list row carries the
 * lists too.
 */
export function useSaveEventLists(eventId: string) {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  const key = ["events", chapterId, eventId];
  return useMutation({
    mutationKey: ["events", "save-lists", eventId],
    mutationFn: async (patch: EventListsPatch) => {
      const { data, error } = await client.PATCH("/v1/events/{id}", {
        params: { path: { id: eventId } },
        body: patch as components["schemas"]["UpdateEventDto"],
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<unknown>(key);
      if (before && typeof before === "object") {
        queryClient.setQueryData(key, { ...before, ...patch });
      }
      return { before };
    },
    onError: (_error, _patch, context) => {
      if (context?.before !== undefined) {
        queryClient.setQueryData(key, context.before);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
  });
}
