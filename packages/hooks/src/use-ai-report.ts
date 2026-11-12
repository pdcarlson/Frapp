"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { throwUnlessOk, type components } from "@repo/api-sdk";
import type { AiReportReason, AiReportSubject } from "@repo/validation";
import { isAiNotAvailable } from "./use-ai";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Report this (#4315, `spec/behavior/ai.md` § Stored AI text), shared by web
 * and mobile: whether a report keeps the text (for the sheet to say before
 * it is sent), and sending one.
 */

export type AiReportOutcome = components["schemas"]["AiReportOutcomeDto"];
export type AiReportPolicy = components["schemas"]["AiReportPolicyDto"];

export interface AiReportInput {
  subject: AiReportSubject;
  /** The ask's id, the meeting's id (for its draft), or the suggestion's id. */
  subjectId: string;
  reason: AiReportReason;
  note?: string;
  /** An Ask answer or a channel summary: its `report_receipt`, as it came. */
  receipt?: string | null;
}

const aiReportKeys = {
  policy: (chapterId: string | null | undefined) =>
    ["ai", "reports", "policy", chapterId] as const,
};

/**
 * What a report keeps. `keeps_text: false` means the server holds no
 * sealing key, and the sheet says only the reason and note are sent. Null
 * when the server has no AI.
 */
export function useAiReportPolicy(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: aiReportKeys.policy(chapterId),
    queryFn: async (): Promise<AiReportPolicy | null> => {
      const result = await client.GET("/v1/ai/reports");
      if (isAiNotAvailable(result.error)) return null;
      throwUnlessOk(result);
      return result.data ?? null;
    },
    // A server setting: it changes on a deploy, not while the sheet is open.
    staleTime: 10 * 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

export function useReportAi() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["ai-reports", "create"],
    // A second send of the same report is answered `already_reported`, so a
    // retry is harmless, but the member presses Send again themselves.
    retry: false,
    mutationFn: async (input: AiReportInput): Promise<AiReportOutcome> => {
      const note = input.note?.trim();
      const result = await client.POST("/v1/ai/reports", {
        body: {
          subject: input.subject,
          subject_id: input.subjectId,
          reason: input.reason,
          ...(note ? { note } : {}),
          ...(input.receipt ? { receipt: input.receipt } : {}),
        },
      });
      throwUnlessOk(result);
      if (!result.data) throw new Error("The report route returned no body.");
      return result.data;
    },
  });
}
