"use client";

import { useEffect, useMemo, useState } from "react";
import { useChapterRoster } from "@repo/hooks";
import type { BoxSuggestion } from "@/lib/backwork-bulk/suggest-boxes";
import type { SuggestedBoxes } from "@/lib/backwork-bulk/pdf";
import type { Prepared, Submission } from "@/lib/backwork-bulk/session";
import type { QueueItem } from "@/lib/bulk-upload/queue";

/** One search per loaded document, however often the page re-renders. */
const searches = new WeakMap<Prepared, Promise<SuggestedBoxes>>();

/**
 * Suggested boxes for the document in the editor (#5245,
 * `lib/backwork-bulk/suggest-boxes.ts`), searched on this device once it has
 * loaded and the chapter's names are in. Null until the search is done.
 */
export function useSuggestedBoxes(
  item: QueueItem<Prepared, Submission> | null,
): BoxSuggestion | null {
  const roster = useChapterRoster();
  // A roster that failed to load only costs the name matches.
  const settled = roster.isSuccess || roster.isError;
  const names = useMemo(
    () =>
      (roster.data ?? [])
        .map((member) => member.display_name)
        .filter((name): name is string => typeof name === "string" && name.trim() !== ""),
    [roster.data],
  );
  const [result, setResult] = useState<BoxSuggestion | null>(null);
  const id = item?.id;
  const prepared = item?.prepared;

  useEffect(() => {
    if (!id || !prepared || !settled) return;
    let live = true;
    let search = searches.get(prepared);
    if (!search) {
      search = import("@/lib/backwork-bulk/pdf").then(({ suggestDocumentBoxes }) =>
        suggestDocumentBoxes(prepared.doc, names),
      );
      searches.set(prepared, search);
    }
    search.then(
      (found) => {
        if (live) setResult({ id, ...found });
      },
      () => {
        if (live) setResult({ id, boxes: {}, textLength: -1 });
      },
    );
    return () => {
      live = false;
    };
  }, [id, prepared, settled, names]);

  return result?.id === id ? result : null;
}
