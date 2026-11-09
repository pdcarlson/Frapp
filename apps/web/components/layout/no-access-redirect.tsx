"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccessibleChapters, useMyPermissions } from "@repo/hooks";
import { asArray } from "@/lib/utils";
import { isLockedOutOfChapter } from "@/lib/auth/no-access";

/**
 * Sends a member whose roles grant nothing to `/no-access` (#3236).
 *
 * `spec/ui/web-dashboard/README.md` § Gating & routing semantics says such a
 * member lands there, and until this nothing routed anyone to the page. They
 * landed on `/chat` instead, and chat is not open to them: `ChatController`
 * and the chat sidebar require `members:view`, so every read 403s and the
 * screen they were dropped on could only fail.
 *
 * The rule, `isLockedOutOfChapter`, fires only on an answer, and only for a
 * member of exactly one chapter; `/join` shares it (#3850). No chapter at all
 * is the chapter wizard's case, and with no active chapter the read never
 * runs.
 */
export function NoAccessRedirect() {
  const router = useRouter();
  const { data } = useMyPermissions();
  const chapters = useAccessibleChapters();
  const lockedOut =
    chapters.isSuccess &&
    isLockedOutOfChapter(
      data?.permissions,
      asArray<unknown>(chapters.data).length,
    );

  useEffect(() => {
    if (lockedOut) router.replace("/no-access");
  }, [lockedOut, router]);

  return null;
}
