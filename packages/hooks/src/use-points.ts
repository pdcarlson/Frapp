"use client";

import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  isDefinitiveClientError,
  randomClientId,
  statusOf,
} from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

type PointWindow = "all" | "semester" | "month";

export function useMyPoints(window?: PointWindow, semesterArchiveId?: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["points", chapterId, "me", window, semesterArchiveId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/me", {
        params: {
          query: { window, semester_archive_id: semesterArchiveId },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    // Matches every other read in this file: without an active chapter the
    // request cannot resolve a scope, and an ungated fetch would surface as a
    // page-level error rather than the "no chapter selected" empty state.
    enabled: !!chapterId,
  });
}

export function useLeaderboard(
  window?: PointWindow,
  semesterArchiveId?: string,
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["points", chapterId, "leaderboard", window, semesterArchiveId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/leaderboard", {
        params: {
          query: { window, semester_archive_id: semesterArchiveId },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId,
  });
}

export function usePointsTransactions(options?: {
  userId?: string;
  category?:
    | "ATTENDANCE"
    | "ACADEMIC"
    | "SERVICE"
    | "FINE"
    | "MANUAL"
    | "STUDY";
  flagged?: boolean;
  before?: string;
  limit?: number;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["points", chapterId, "transactions", options],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/points/transactions", {
        params: {
          query: {
            user_id: options?.userId,
            category: options?.category,
            flagged:
              options?.flagged === undefined
                ? undefined
                : options.flagged
                  ? "true"
                  : "false",
            before: options?.before,
            limit: options?.limit,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId,
  });
}

/** What a treasurer submits. The hook adds the idempotency key. */
export type AdjustPointsBody = {
  target_user_id: string;
  amount: number;
  category: "MANUAL" | "FINE";
  reason: string;
};

type AdjustPointsVariables = AdjustPointsBody & { client_message_id: string };

/**
 * Whether a failed adjustment may have written its ledger row. Only a
 * definitive refusal proves it didn't: a 5xx, a dropped connection (no status
 * at all) and the 4xx an intermediary emits after the origin may have
 * committed (`isDefinitiveClientError`'s carve-out) all leave it open.
 */
function mayHaveCommitted(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || !isDefinitiveClientError(status);
}

/**
 * The error body with the response status on it. Nest's bodies carry
 * `statusCode` already; a gateway's HTML 502 parses to a string that carries
 * nothing, and without the status `mayHaveCommitted` could not tell it from a
 * dropped connection.
 */
function withResponseStatus(error: unknown, status: number): unknown {
  if (statusOf(error) !== undefined) return error;
  return typeof error === "object" && error !== null
    ? { ...error, status }
    : { status };
}

/**
 * `POST /v1/points/adjust` with an idempotency key (#1906), so a response lost
 * after the ledger row committed is safe to retry. The server dedupes on
 * `(chapter_id, client_message_id)` and answers a replay with the original row
 * (`spec/behavior/points.md` § Anti-Fraud), so a retry heals instead of writing
 * a second row into the append-only ledger.
 *
 * One key per adjustment the treasurer means, bound to its exact body:
 *
 * - It rides in the mutation's `variables`, which TanStack keeps across its
 *   automatic retries. Minting inside `mutationFn` would re-mint per attempt.
 * - Submitting the same body again after a failure reuses it. That is the
 *   dialog's explicit retry, and if the first attempt landed it replays.
 * - A success, or a definitive refusal, releases it, so a deliberate second
 *   grant of the same amount is a second legitimate row with a fresh key. A
 *   changed body mints a fresh key too.
 *
 * Retries go only to failures that may have committed, at most twice (the web
 * client's `retry: 2` default, made conditional): retrying a definitive 4xx
 * repeats a refusal.
 */
export function useAdjustPoints() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);

  function keyFor(body: AdjustPointsBody): string {
    const fingerprint = JSON.stringify([
      body.target_user_id,
      body.amount,
      body.category,
      body.reason,
    ]);
    if (pending.current?.fingerprint !== fingerprint) {
      pending.current = { fingerprint, key: randomClientId() };
    }
    return pending.current.key;
  }

  function release(key: string) {
    if (pending.current?.key === key) pending.current = null;
  }

  const mutation = useMutation({
    retry: (failureCount, error) => failureCount < 2 && mayHaveCommitted(error),
    mutationFn: async (variables: AdjustPointsVariables) => {
      const { data, error, response } = await client.POST(
        "/v1/points/adjust",
        { body: variables },
      );
      if (error) throw withResponseStatus(error, response.status);
      return data;
    },
    onSuccess: (_data, variables) => {
      release(variables.client_message_id);
      queryClient.invalidateQueries({ queryKey: ["points", chapterId] });
    },
    onError: (error, variables) => {
      if (!mayHaveCommitted(error)) release(variables.client_message_id);
    },
  });

  return {
    ...mutation,
    mutate: (
      body: AdjustPointsBody,
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ ...body, client_message_id: keyFor(body) }, options),
    mutateAsync: (
      body: AdjustPointsBody,
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) =>
      mutation.mutateAsync(
        { ...body, client_message_id: keyFor(body) },
        options,
      ),
  };
}
