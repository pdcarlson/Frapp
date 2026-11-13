"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isCardReadMiss } from "./card-read-miss";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { invalidatePointReads } from "./use-points";
import { semesterSince } from "./document-library";

/**
 * `userId` is not a convenience — on this endpoint it is the difference between
 * a member's own history and the whole chapter's. `GET /v1/service-entries`
 * resolves `userId: isAdmin ? query.userId : userId`, so omitting it pins a
 * non-admin to themselves but hands a `service:approve` holder every entry in
 * the chapter. A screen that presents the result as the viewer's own must pass
 * the viewer's id; only a deliberate officer surface (the web approval queue)
 * may omit it.
 *
 * `options.enabled` exists so such a screen can hold the request until the
 * viewer id is known, rather than firing once unscoped and then again scoped.
 * Same shape as {@link useInvoices}.
 */
export function useServiceEntries(
  userId?: string,
  filters?: {
    status?: "PENDING" | "APPROVED" | "REJECTED";
    start_date?: string;
    end_date?: string;
  },
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  // The chapter id is in the key because the endpoint resolves the chapter from
  // the request header, not from anything in this call — so without it two
  // chapters' histories share one cache entry and a member who switches sees
  // the previous chapter's hours under the new one.
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["service-entries", chapterId, userId, filters],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/service-entries", {
        params: {
          query: {
            userId,
            status: filters?.status,
            start_date: filters?.start_date,
            end_date: filters?.end_date,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * One row of `GET /v1/service-entries/leaderboard`: a member's APPROVED
 * service time in the window. The route declares no OpenAPI response schema,
 * so this mirrors the API's `ServiceLeaderboardRow`
 * (`apps/api/src/domain/entities/service-entry.entity.ts`), and
 * {@link selectServiceLeaderboard} narrows the untyped body into it.
 */
export type ServiceLeaderboardRow = {
  user_id: string;
  member_name: string;
  total_minutes: number;
  entry_count: number;
};

/**
 * The leaderboard body as rows, dropping any that lack an id or a number. The
 * server's order is the ranking (approved minutes descending, then name), so
 * this keeps it rather than sorting again.
 */
export function selectServiceLeaderboard(
  data: unknown,
): ServiceLeaderboardRow[] {
  if (!Array.isArray(data)) return [];
  const rows: ServiceLeaderboardRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const minutes = Number(row.total_minutes);
    if (typeof row.user_id !== "string" || !Number.isFinite(minutes)) continue;
    const count = Number(row.entry_count);
    rows.push({
      user_id: row.user_id,
      member_name: typeof row.member_name === "string" ? row.member_name : "",
      total_minutes: minutes,
      entry_count: Number.isFinite(count) ? count : 0,
    });
  }
  return rows;
}

/**
 * The first day of "this semester" as a bare `YYYY-MM-DD`: the day after the
 * latest archive's `end_date` ({@link semesterSince}), which is the day the
 * Activity page's Service hours tile counts from
 * (`ActivityStandingService`, `spec/behavior/semester-rollover.md`). `null`
 * when the chapter has never rolled over, so this semester is all time.
 */
export function serviceSemesterStartDate(
  archives: readonly { end_date: string; created_at?: string }[],
): string | null {
  const since = semesterSince(archives);
  return since
    ? new Date(since.getTime() + 1).toISOString().slice(0, 10)
    : null;
}

/**
 * The chapter's service leaderboard (`GET /v1/service-entries/leaderboard`,
 * `members:view`): members ranked by APPROVED minutes, with an optional
 * inclusive `start_date` / `end_date` on the service date; omit both for all
 * time. Under the `["service-entries"]` prefix, so an approval re-ranks it.
 * Pass `enabled: false` to hold it, such as while the semester's start is
 * still being read.
 */
export function useServiceLeaderboard(
  range?: { start_date?: string; end_date?: string },
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: [
      "service-entries",
      chapterId,
      "leaderboard",
      range?.start_date ?? null,
      range?.end_date ?? null,
    ],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/service-entries/leaderboard",
        {
          params: {
            query: {
              start_date: range?.start_date,
              end_date: range?.end_date,
            },
          },
        },
      );
      if (error) throw error;
      return selectServiceLeaderboard(data);
    },
    staleTime: 30_000,
    enabled: !!chapterId && (options?.enabled ?? true),
  });
}

/**
 * The SERVICE points rate approving an entry applies right now
 * (`GET /v1/service-entries/points-rate`, `service:approve`), for the review
 * queue's preview of what Approve will award (#3862). Pass `enabled: false`
 * for a viewer without `service:approve`, who would only get a 403.
 *
 * Under the `["service-entries"]` prefix, so a review refetches it: the server
 * reads the rate again at every approval, and a refetch then picks up a rate
 * another officer changed in the meantime.
 */
export function useServicePointsRate(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["service-entries", chapterId, "points-rate"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/service-entries/points-rate",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId && (options?.enabled ?? true),
  });
}

/**
 * One service entry, as `GET /v1/service-entries/{id}` returns it, or `null`
 * when the server answers that there is none for this viewer: what a chat
 * hours card reads its live review status from.
 *
 * The route needs `members:view` and the Hours module, and then answers only
 * the member who logged the entry and a `service:approve` holder; anyone else
 * gets a 403. A caller that knows the viewer can't read it passes an empty id,
 * which holds the request (see `canReadCardServiceEntry`). Under the list's
 * `["service-entries"]` prefix, so a review or a delete from any screen
 * refreshes it.
 *
 * A 404, or a 403 a retry won't change, resolves to `null` rather than
 * throwing (`isCardReadMiss`). Both are answers (the entry was deleted, or the
 * viewer lost a permission or the module was turned off), and a thrown refetch
 * would keep the badge read before it, so a deleted entry would go on saying
 * "Approved". Resolving also keeps an expected miss out of the query's retries
 * and out of Sentry. `ChapterGuard`'s `chapter.context.mismatch` still throws:
 * it clears once the token catches up with a chapter switch. No chapter, no
 * read, as for every chapter-scoped query.
 */
export function useServiceEntry(id: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["service-entries", chapterId, "detail", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/service-entries/{id}", {
        params: { path: { id } },
      });
      if (error) {
        if (isCardReadMiss(error)) return null;
        throw error;
      }
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId && !!id,
  });
}

export function useCreateServiceEntry() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["service-entries", "create-service-entry"],
    mutationFn: async (body: {
      date: string;
      duration_minutes: number;
      description: string;
      proof_path?: string;
    }) => {
      const { data, error } = await client.POST("/v1/service-entries", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-entries"] });
    },
  });
}

export function useRequestServiceProofUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["service-entries", "request-service-proof-upload-url"],
    mutationFn: async (body: {
      filename: string;
      content_type: string;
      /** Declared so the API's own size check answers with a readable 400. */
      size_bytes?: number;
    }) => {
      const { data, error } = await client.POST(
        "/v1/service-entries/proof-upload-url",
        { body },
      );
      if (error) throw error;
      return data;
    },
  });
}

export function useGetServiceProofUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["service-entries", "get-service-proof-url"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.GET(
        "/v1/service-entries/{id}/proof-url",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
  });
}

export function useReviewServiceEntry() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["service-entries", "review-service-entry"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        status: "APPROVED" | "REJECTED";
        review_comment?: string;
      };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/service-entries/{id}/review",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { body }) => {
      queryClient.invalidateQueries({ queryKey: ["service-entries"] });
      // Approval awards the submitter's SERVICE points in the same transaction.
      if (body.status === "APPROVED") void invalidatePointReads(queryClient);
    },
  });
}

export function useDeleteServiceEntry() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["service-entries", "delete-service-entry"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/service-entries/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-entries"] });
    },
  });
}
