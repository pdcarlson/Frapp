"use client";

import { useCallback, useMemo } from "react";
import {
  useDocumentStars,
  useSetDocumentPin,
  useSetDocumentStar,
  type DocumentMarkTarget,
} from "@repo/hooks";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * Pins (chapter-wide, `chapter_docs:manage`) and stars (the member's own) for
 * `/documents` (#3934, `spec/behavior/chapter-docs.md` § Pinned and starred).
 *
 * A star moves on the tap and the hook re-reads the server after; a pin moves
 * when the server has it, because everyone sees it. Either failure is said in
 * a toast, since the mark going back on its own would read as a misclick.
 */
export function useDocumentMarks() {
  const { toast } = useToast();
  const starsQuery = useDocumentStars();
  const setStar = useSetDocumentStar();
  const setPin = useSetDocumentPin();

  const starred = useMemo(
    () => ({
      folders: new Set(starsQuery.data?.folder_ids ?? []),
      documents: new Set(starsQuery.data?.document_ids ?? []),
    }),
    [starsQuery.data],
  );

  // Stable while the stars are, so a list memoised on it re-tiers only when
  // a star changes.
  const isStarred = useCallback(
    (target: DocumentMarkTarget): boolean =>
      target.kind === "folder"
        ? starred.folders.has(target.id)
        : starred.documents.has(target.id),
    [starred],
  );

  function toggleStar(target: DocumentMarkTarget, name: string) {
    const next = !isStarred(target);
    setStar.mutate(
      { target, starred: next },
      {
        onError: (error) =>
          toast({
            title: next ? `Couldn't star ${name}` : `Couldn't unstar ${name}`,
            description: getErrorMessage(error, "Try again in a moment."),
            variant: "destructive",
          }),
      },
    );
  }

  async function setPinned(
    target: DocumentMarkTarget,
    name: string,
    pinned: boolean,
  ) {
    try {
      await setPin.mutateAsync({ target, pinned });
      toast({
        title: pinned ? `Pinned ${name}` : `Unpinned ${name}`,
        description: pinned
          ? "It sits at the top of Documents for everyone in the chapter."
          : "It's no longer at the top for the chapter.",
      });
    } catch (error) {
      toast({
        title: pinned ? `Couldn't pin ${name}` : `Couldn't unpin ${name}`,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  return {
    isStarred,
    toggleStar,
    setPinned,
    pinBusy: setPin.isPending,
  };
}

export type DocumentMarks = ReturnType<typeof useDocumentMarks>;
