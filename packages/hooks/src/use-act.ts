"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codeOf, throwUnlessOk, type components } from "@repo/api-sdk";
import { aiConsentKey, isAiNotAvailable } from "./use-ai";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Asking Frapp to do something (#718, `spec/behavior/ai.md` § Asking Frapp to
 * do something), shared by web and mobile.
 *
 * A request is answered with a proposal, never a change. The proposal is an
 * AI suggestion only the asker can open, so Confirm and Cancel are the
 * suggestion hooks (`useAcceptAiSuggestion`, `useDismissAiSuggestion`).
 */

export type ActResponse = components["schemas"]["ActResponseDto"];
export type ActNote = components["schemas"]["ActNoteDto"];
export type ActEventChoice = components["schemas"]["ActEventChoiceDto"];

const actStatusKey = (chapterId: string | null | undefined) =>
  ["ai", "act", "status", chapterId] as const;

/**
 * The actions the caller can ask for, or `null` when they cannot ask for any
 * at all: the server has no AI (404), or they do not hold `ai:use` and
 * `ai:act` (403). A screen offers the Do side of Ask only for a non-null,
 * non-empty answer.
 */
export function useActStatus(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: actStatusKey(chapterId),
    queryFn: async (): Promise<string[] | null> => {
      const result = await client.GET("/v1/ai/act");
      if (isAiNotAvailable(result.error)) return null;
      if (result.response.status === 403) return null;
      throwUnlessOk(result);
      return result.data?.actions ?? [];
    },
    staleTime: 60_000,
    retry: false,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** A refusal the consent sheet answers; the gate reads consent again. */
function useConsentRefresh() {
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (codeOf(error) === "ai.consent.required") {
      void queryClient.invalidateQueries({ queryKey: aiConsentKey });
    }
  };
}

function bodyOf(data: ActResponse | undefined): ActResponse {
  if (data === undefined) throw new Error("The act route returned no body.");
  return data;
}

/** One request in the member's words; the answer is a proposal or a reason. */
export function useActRequest() {
  const client = useFrappClient();
  const onError = useConsentRefresh();
  return useMutation({
    mutationKey: ["ai-act", "request"],
    retry: false,
    mutationFn: async (request: string): Promise<ActResponse> => {
      const result = await client.POST("/v1/ai/act", { body: { request } });
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    onError,
  });
}

/** The follow-up to `needs_event`: which event "everyone who came" means. */
export function useActEventAudience() {
  const client = useFrappClient();
  const onError = useConsentRefresh();
  return useMutation({
    mutationKey: ["ai-act", "event-audience"],
    retry: false,
    mutationFn: async (input: {
      eventId: string;
      amount: number;
      reason: string;
    }): Promise<ActResponse> => {
      const result = await client.POST("/v1/ai/act/event-audience", {
        body: {
          event_id: input.eventId,
          amount: input.amount,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
      throwUnlessOk(result);
      return bodyOf(result.data);
    },
    onError,
  });
}
