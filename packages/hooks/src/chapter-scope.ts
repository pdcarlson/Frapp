"use client";

import { useListChapters } from "./use-chapters";
import { useActiveChapterId } from "./use-frapp-client";

/**
 * Whether a chapter-scoped read can be answered yet.
 *
 * - `chapter`: a chapter id is known, or the server can resolve one (a sole
 *   membership), or the membership read failed and the server is left to
 *   decide.
 * - `none`: the server would refuse every chapter-scoped read with
 *   `400 chapter.context.required` until a chapter is picked. That is no
 *   membership at all, or two or more with no chapter id to say which.
 * - `resolving`: not known yet.
 */
export type ChapterScope = "chapter" | "none" | "resolving";

/**
 * Pure half of {@link useChapterScope}, so the decision is tested without a
 * query client.
 *
 * A known chapter id settles it. Without one, `GET /v1/chapters` decides,
 * because a null id is not the same as no chapter: a member whose token has no
 * `active_chapter_id` claim (the rollback playbook disables the claim hook, and
 * web's persisted store starts at null) still reads their chapter when they
 * have exactly one, because `ChapterGuard` resolves a sole membership
 * server-side. `apps/mobile/lib/auth-gate.ts` and the pane-state comment in
 * `apps/web/components/chat/chat-shell.tsx` record what went wrong when that
 * was treated as "no chapter".
 *
 * A list the server has answered wins over a refetch of it that failed, as
 * mobile's auth gate rules for the same read: a cached `[]` stays `none`. Only
 * a list that never answered, retries spent, fails open to `chapter`, so an
 * outage of that one endpoint leaves each read to the server rather than
 * holding chat back for good. Until then the reads wait (`resolving`), which is
 * the price of not sending them blind: one round trip for a claim-less member,
 * and the query client's retries when the endpoint is down.
 */
export function resolveChapterScope(input: {
  chapterId: string | null;
  memberships: readonly unknown[] | undefined;
  /** The read has failed with its retries spent, at least once. */
  membershipsFailed: boolean;
}): ChapterScope {
  if (input.chapterId) return "chapter";
  if (input.memberships) {
    return input.memberships.length === 1 ? "chapter" : "none";
  }
  if (input.membershipsFailed) return "chapter";
  return "resolving";
}

/**
 * The chapter scope for the reads that have no `enabled: !!chapterId` gate of
 * their own: the channel family in `use-chat.ts` and `useTasks` (#4094).
 *
 * They went ungated so a claim-less sole member could still load chat, and so
 * they fired for a signed-in user with no membership at all: on a cold launch
 * through an invite link, mobile's `(app)` layout paints the tabs for a moment
 * before `useOnboardingRedirect` moves the user to `/join`, and chat home's
 * reads came back 400. Gating them here sends nothing until the server can
 * scope them.
 *
 * The chapters list is read only while the chapter id is null and the caller
 * is enabled, so the common case (a claim on the token) waits on nothing, and
 * a caller mounted above the auth gate that passes `enabled: false` triggers
 * no read with no session. It shares `useListChapters`' cache entry, which
 * mobile's auth gate and web's chapter switcher already read.
 *
 * A gated query that is disabled stays `isPending`, so a screen that draws a
 * skeleton while pending has to branch on `none` itself.
 */
export function useChapterScope(options?: { enabled?: boolean }): ChapterScope {
  const chapterId = useActiveChapterId();
  const enabled = options?.enabled ?? true;
  const memberships = useListChapters({ enabled: enabled && !chapterId });
  return resolveChapterScope({
    chapterId,
    memberships: Array.isArray(memberships.data) ? memberships.data : undefined,
    // `errorUpdateCount`, not `isError`: TanStack puts a query with no data
    // back to pending, error cleared, on every refetch, so `isError` alone
    // would close the gate again on each focus or mount during an outage
    // (`gateReadStatus` in `apps/mobile/lib/auth-gate.ts` has the same rule).
    membershipsFailed: memberships.isError || memberships.errorUpdateCount > 0,
  });
}
