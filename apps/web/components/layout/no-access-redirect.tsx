"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccessibleChapters, useMyPermissions } from "@repo/hooks";
import { asArray } from "@/lib/utils";

/**
 * Sends a member whose roles grant nothing to `/no-access` (#3236).
 *
 * `spec/ui/web-dashboard/README.md` § Gating & routing semantics says such a
 * member lands there, and until this nothing routed anyone to the page. They
 * landed on `/chat` instead, and chat is not open to them: `ChatController`
 * and the chat sidebar require `members:view`, so every read 403s and the
 * screen they were dropped on could only fail.
 *
 * It fires only on an answer. While the permission read is loading or
 * disabled there is no `data`, and a failed read with nothing cached has none
 * either, so neither is mistaken for "no permissions" (the same rule `<Can>`
 * keeps between offline and denied). A failed *refetch* keeps the last answer,
 * and that answer is still the member's.
 *
 * Only for a member of exactly one chapter. `/no-access` has no chapter
 * switcher, so a member of another chapter would be stranded there;
 * the shell they already have is where they switch. No chapter at all is the
 * chapter wizard's case, and with no active chapter the read never runs.
 */
export function NoAccessRedirect() {
  const router = useRouter();
  const { data } = useMyPermissions();
  const chapters = useAccessibleChapters();
  const permissions = data?.permissions;
  const lockedOut =
    Array.isArray(permissions) &&
    permissions.length === 0 &&
    chapters.isSuccess &&
    asArray<unknown>(chapters.data).length === 1;

  useEffect(() => {
    if (lockedOut) router.replace("/no-access");
  }, [lockedOut, router]);

  return null;
}
