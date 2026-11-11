"use client";

import { useListChapters } from "./use-chapters";
import { useActiveChapterId } from "./use-frapp-client";

/**
 * Whether a chapter-scoped read can be answered yet.
 *
 * - `chapter`: there is a chapter for the API to scope the read to.
 * - `none`: the caller has no membership, so every chapter-scoped read would be
 *   refused with `400 chapter.context.required`.
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
 * web's persisted store starts at null) still reads their chapter, because
 * `ChapterGuard` resolves a sole membership server-side. `apps/mobile/lib/auth-gate.ts`
 * and the pane-state comment in `apps/web/components/chat/chat-shell.tsx`
 * record what went wrong when that was treated as "no chapter".
 *
 * A failed chapters read fails open to `chapter`, so an outage of that one
 * endpoint can't blank chat; the server still decides each read.
 */
export function resolveChapterScope(input: {
  chapterId: string | null;
  memberships: readonly unknown[] | undefined;
  membershipsFailed: boolean;
}): ChapterScope {
  if (input.chapterId) return "chapter";
  if (input.memberships && input.memberships.length > 0) return "chapter";
  if (input.membershipsFailed) return "chapter";
  if (input.memberships) return "none";
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
 * reads came back 400. Gating them here sends nothing until a chapter is known
 * or a membership is listed.
 *
 * The chapters list is read only while the chapter id is null and the caller
 * is enabled, so the common case (a claim on the token) waits on nothing, and
 * a caller mounted above the auth gate that passes `enabled: false` triggers
 * no read with no session. It shares `useListChapters`' cache entry, which
 * mobile's auth gate and web's chapter switcher already read.
 */
export function useChapterScope(options?: { enabled?: boolean }): ChapterScope {
  const chapterId = useActiveChapterId();
  const enabled = options?.enabled ?? true;
  const memberships = useListChapters({ enabled: enabled && !chapterId });
  return resolveChapterScope({
    chapterId,
    memberships: Array.isArray(memberships.data) ? memberships.data : undefined,
    membershipsFailed: memberships.isError,
  });
}
