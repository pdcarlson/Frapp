"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgendaSuggestionList, EventAgendaItem } from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

const EMPTY: AgendaSuggestionList = {
  suggestions: [],
  generated_at: null,
  ai_available: false,
};

function suggestionsKey(chapterId: string | null, eventId: string) {
  return ["agenda-suggestions", chapterId, eventId] as const;
}

/**
 * An upcoming event's Suggested agenda items (#5534,
 * `GET /v1/events/{id}/agenda-suggestions`), tabled matters first, for a
 * member who can edit the event. When the model has never written this
 * event's suggestions and can, they are asked for once (`refresh`), so the
 * first officer to open the event pays for one model call, not every view.
 *
 * Suggestions are an extra: a failed read is an empty list, not an error
 * state, and it is not retried.
 */
export function useAgendaSuggestions(
  eventId: string,
  options: { enabled?: boolean } = {},
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const key = suggestionsKey(chapterId, eventId);
  const enabled = !!chapterId && (options.enabled ?? true);

  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<AgendaSuggestionList> => {
      const { data, error } = await client.GET(
        "/v1/events/{id}/agenda-suggestions",
        { params: { path: { id: eventId } }, signal },
      );
      if (error !== undefined || data === undefined) return EMPTY;
      return data as AgendaSuggestionList;
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    enabled,
  });

  const refresh = useMutation({
    mutationKey: ["agenda-suggestions-refresh", eventId],
    mutationFn: async (): Promise<AgendaSuggestionList> => {
      const { data, error } = await client.POST(
        "/v1/events/{id}/agenda-suggestions/refresh",
        { params: { path: { id: eventId } } },
      );
      if (error !== undefined || data === undefined) throw error;
      return data as AgendaSuggestionList;
    },
    onSuccess: (list) => queryClient.setQueryData(key, list),
  });

  // The model's first suggestions for this event, asked for once per mount.
  const asked = useRef(false);
  const data = query.data;
  const { mutate } = refresh;
  useEffect(() => {
    if (!enabled || asked.current || !data) return;
    if (data.ai_available && data.generated_at === null) {
      asked.current = true;
      mutate();
    }
  }, [enabled, data, mutate]);

  return {
    suggestions: data?.suggestions ?? [],
    aiAvailable: data?.ai_available ?? false,
    loading: query.isPending && enabled,
    /** The model is writing suggestions now. */
    writing: refresh.isPending,
    refreshFailed: refresh.isError,
    /** Ask the model again (Suggest again). */
    refresh: () => refresh.mutate(),
  };
}

/**
 * Add and Dismiss. Both take the row off the list at once. Add first sends
 * any agenda edits still waiting (`flushAgenda`, the editor's `flush`), so
 * the server appends to the list the officer sees, then puts the agenda the
 * server saved into the event's read. A failed Add or Dismiss puts the list
 * back as the server has it.
 */
export function useAgendaSuggestionActions(
  eventId: string,
  options: { flushAgenda?: () => Promise<void> } = {},
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const key = suggestionsKey(chapterId, eventId);
  const detailKey = ["events", chapterId, eventId];

  const removeFromList = (id: string) =>
    queryClient.setQueryData<AgendaSuggestionList>(key, (current) =>
      current
        ? {
            ...current,
            suggestions: current.suggestions.filter((row) => row.id !== id),
          }
        : current,
    );

  const add = useMutation({
    mutationKey: ["agenda-suggestion-add", eventId],
    mutationFn: async (suggestionId: string): Promise<EventAgendaItem[]> => {
      await options.flushAgenda?.();
      const { data, error } = await client.POST(
        "/v1/events/{id}/agenda-suggestions/{suggestionId}/add",
        { params: { path: { id: eventId, suggestionId } } },
      );
      if (error !== undefined || data === undefined) throw error;
      return data.agenda as EventAgendaItem[];
    },
    onMutate: removeFromList,
    onSuccess: async (agenda) => {
      queryClient.setQueryData(detailKey, (row: unknown) =>
        row && typeof row === "object" ? { ...row, agenda } : row,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailKey, exact: true }),
        queryClient.invalidateQueries({
          queryKey: ["events", chapterId],
          exact: true,
        }),
      ]);
    },
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const dismiss = useMutation({
    mutationKey: ["agenda-suggestion-dismiss", eventId],
    mutationFn: async (suggestionId: string) => {
      const { error } = await client.POST(
        "/v1/events/{id}/agenda-suggestions/{suggestionId}/dismiss",
        { params: { path: { id: eventId, suggestionId } } },
      );
      if (error !== undefined) throw error;
    },
    onMutate: removeFromList,
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    add: (suggestionId: string) => add.mutateAsync(suggestionId),
    dismiss: (suggestionId: string) => dismiss.mutateAsync(suggestionId),
    adding: add.isPending,
  };
}
