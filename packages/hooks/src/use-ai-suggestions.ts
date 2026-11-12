"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { throwUnlessOk, type components } from "@repo/api-sdk";
import { isAiNotAvailable } from "./use-ai";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { invalidatePointReads } from "./use-points";
import { taskKeys } from "./use-tasks";

/**
 * AI suggestions (#4309, #4313, `spec/behavior/ai.md` § Suggestions): the
 * proposals an officer accepts, changes or dismisses, shared by web and
 * mobile. Suggested tasks from posted minutes are the first kind.
 *
 * The server lists only what the caller could accept now, so a member with
 * no permission, or a server with `AI_ENABLED` off (404 `ai.not_available`),
 * reads an empty list and a screen draws nothing.
 */

/** `data.target.screen` of the one push a batch of suggestions sends. */
export const AI_SUGGESTIONS_NOTIFICATION_SCREEN = "ai_suggestions";

export type AiSuggestion = components["schemas"]["AiSuggestionDto"];
export type AiSuggestionSourceType = AiSuggestion["source"]["type"];
/** An officer's changes to a suggested task, sent with Accept. */
export type TaskSuggestionEdits =
  components["schemas"]["TaskSuggestionEditsDto"];
/** An officer's changes to a proposed points change, sent with Confirm. */
export type PointsSuggestionEdits =
  components["schemas"]["PointsSuggestionEditsDto"];
/** Why a suggestion is dismissed, when the member says: `already_doing`. */
export type AiSuggestionDismissReason = NonNullable<
  components["schemas"]["DismissAiSuggestionDto"]["reason"]
>;
export type AiSuggestionDecision =
  components["schemas"]["AiSuggestionDecisionDto"];
export type AiSuggestionDecideItem =
  components["schemas"]["AiSuggestionDecideItemDto"];
export type AiSuggestionDecideOutcome =
  components["schemas"]["AiSuggestionDecideOutcomeDto"];

export interface AiSuggestionSourceRef {
  type: AiSuggestionSourceType;
  id: string;
}

export interface AiSuggestionList {
  items: AiSuggestion[];
  has_more: boolean;
}

const EMPTY: AiSuggestionList = { items: [], has_more: false };

export const aiSuggestionKeys = {
  /** Every suggestions list of a chapter: the whole one and each source's. */
  all: (chapterId: string | null | undefined) =>
    ["ai", "suggestions", chapterId] as const,
  list: (
    chapterId: string | null | undefined,
    source?: AiSuggestionSourceRef,
  ) =>
    [
      "ai",
      "suggestions",
      chapterId,
      source ? `${source.type}:${source.id}` : "all",
    ] as const,
};

function bodyOf<T>(data: T | undefined): T {
  if (data === undefined) throw new Error("The AI route returned no body.");
  return data;
}

/**
 * The waiting suggestions the caller could accept, newest first: all of
 * them (the Suggested list), or one source's (the list on posted minutes).
 */
export function useAiSuggestions(options?: {
  source?: AiSuggestionSourceRef;
  enabled?: boolean;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const source = options?.source;
  return useQuery({
    queryKey: aiSuggestionKeys.list(chapterId, source),
    queryFn: async (): Promise<AiSuggestionList> => {
      const result = await client.GET("/v1/ai/suggestions", {
        params: {
          query: source
            ? { source_type: source.type, source_id: source.id }
            : {},
        },
      });
      if (isAiNotAvailable(result.error)) return EMPTY;
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** Takes decided suggestions out of every cached list, before the refetch. */
function useDropFromLists() {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return (ids: readonly string[], made: boolean) => {
    const gone = new Set(ids);
    queryClient.setQueriesData<AiSuggestionList>(
      { queryKey: aiSuggestionKeys.all(chapterId) },
      (list) =>
        list
          ? { ...list, items: list.items.filter((item) => !gone.has(item.id)) }
          : list,
    );
    void queryClient.invalidateQueries({
      queryKey: aiSuggestionKeys.all(chapterId),
    });
    if (made) {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      // An accepted points change or event (#718) lands on those pages.
      void invalidatePointReads(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    }
  };
}

/**
 * Accepts one suggestion, with the officer's changes when they made any. The
 * server checks their permission again and makes the task as them.
 */
export function useAcceptAiSuggestion() {
  const client = useFrappClient();
  const drop = useDropFromLists();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["ai-suggestions", "accept"],
    // A second accept answers 409 while the first is still being made.
    retry: false,
    mutationFn: async ({
      id,
      task,
      points,
      eventId,
    }: {
      id: string;
      task?: TaskSuggestionEdits;
      points?: PointsSuggestionEdits;
      /**
       * For a suggested event (#3930): the event the officer just added
       * through the event form. The accept records it and makes nothing.
       */
      eventId?: string;
    }): Promise<AiSuggestionDecision> => {
      const result = await client.POST("/v1/ai/suggestions/{id}/accept", {
        params: { path: { id } },
        body: eventId
          ? { event: { event_id: eventId } }
          : { ...(task ? { task } : {}), ...(points ? { points } : {}) },
      });
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    onSuccess: (_decision, { id }) => drop([id], true),
    // Refused: someone else decided it, it expired, or its minutes changed.
    onError: () =>
      void queryClient.invalidateQueries({
        queryKey: aiSuggestionKeys.all(chapterId),
      }),
  });
}

export function useDismissAiSuggestion() {
  const client = useFrappClient();
  const drop = useDropFromLists();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["ai-suggestions", "dismiss"],
    mutationFn: async (
      target: string | { id: string; reason?: AiSuggestionDismissReason },
    ): Promise<AiSuggestionDecision> => {
      const { id, reason } =
        typeof target === "string" ? { id: target, reason: undefined } : target;
      const result = await client.POST("/v1/ai/suggestions/{id}/dismiss", {
        params: { path: { id } },
        body: reason ? { reason } : {},
      });
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    onSuccess: (_decision, target) =>
      drop([typeof target === "string" ? target : target.id], false),
    onError: () =>
      void queryClient.invalidateQueries({
        queryKey: aiSuggestionKeys.all(chapterId),
      }),
  });
}

/**
 * Several decisions in one request (Accept all). Each has its own outcome:
 * the ones that went through leave the lists, the rest stay to be seen.
 */
export function useDecideAiSuggestions() {
  const client = useFrappClient();
  const drop = useDropFromLists();
  return useMutation({
    mutationKey: ["ai-suggestions", "decide"],
    retry: false,
    mutationFn: async (
      items: AiSuggestionDecideItem[],
    ): Promise<AiSuggestionDecideOutcome[]> => {
      const result = await client.POST("/v1/ai/suggestions/decide", {
        body: { items },
      });
      throwUnlessOk(result);
      return bodyOf(result.data).outcomes;
    },
    onSuccess: (outcomes) =>
      drop(
        outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.id),
        true,
      ),
  });
}
