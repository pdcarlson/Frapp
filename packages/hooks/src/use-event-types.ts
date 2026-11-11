"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** One of the chapter's event types, as `GET /v1/event-types` serves it. */
export type EventType = components["schemas"]["EventTypeDto"];

/** What a create or an edit of a type may set. */
export type EventTypeFields = {
  name: string;
  point_value: number;
  is_mandatory: boolean;
};

const eventTypesKey = (chapterId: string | null | undefined) =>
  ["event-types", chapterId] as const;

/**
 * The chapter's event types, in its own order (`spec/behavior/events.md`
 * § Event types). The New event form shows them as chips; picking one fills
 * in points and attendance. Needs `members:view`.
 */
export function useEventTypes(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: eventTypesKey(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/event-types");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** Add a type at the end of the list. Needs `events:update`. */
export function useCreateEventType() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["event-types", "create"],
    mutationFn: async (body: EventTypeFields) => {
      const { data, error } = await client.POST("/v1/event-types", { body });
      if (error) throw error;
      return data;
    },
    // Returned, so `mutateAsync` settles after the list is re-read.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: eventTypesKey(chapterId) }),
  });
}

/**
 * Change a type's name, points or attendance. Events already made keep their
 * own values, so only the type list is re-read.
 */
export function useUpdateEventType() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["event-types", "update"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: Partial<EventTypeFields>;
    }) => {
      const { data, error } = await client.PATCH("/v1/event-types/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: eventTypesKey(chapterId) }),
  });
}

/**
 * Delete a type. Its events keep their points and attendance and lose the
 * type, so the event reads are refreshed too.
 */
export function useDeleteEventType() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["event-types", "delete"],
    mutationFn: async (id: string) => {
      const { error } = await client.DELETE("/v1/event-types/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: eventTypesKey(chapterId) }),
        queryClient.invalidateQueries({ queryKey: ["events", chapterId] }),
      ]),
  });
}
