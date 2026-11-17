"use client";

import { useEffect, useMemo, useState } from "react";
import { useChapterRoster } from "@repo/hooks";
import type { BoxSuggestion } from "@/lib/backwork-bulk/suggest-boxes";
import type { SuggestedBoxes } from "@/lib/backwork-bulk/pdf";
import type { Prepared, Submission } from "@/lib/backwork-bulk/session";
import type { QueueItem } from "@/lib/bulk-upload/queue";

/**
 * Finished searches, by document and the names they matched, so coming back to
 * the page doesn't search the same document again. A search that is stopped or
 * fails is not kept.
 */
const finished = new WeakMap<Prepared, { names: string; found: SuggestedBoxes }>();

/**
 * Suggested boxes for the document in the editor (#5245,
 * `lib/backwork-bulk/suggest-boxes.ts`), searched on this device once it has
 * loaded and the chapter's names are in. Null until the search is done.
 *
 * The search doesn't wait on a roster that failed to load or is waiting for a
 * connection: labels, emails and ID numbers need no names. It stops when its
 * document leaves the editor, so the next document's pages aren't held up
 * behind it on the shared pdf.js worker.
 */
export function useSuggestedBoxes(
  item: QueueItem<Prepared, Submission> | null,
): BoxSuggestion | null {
  const roster = useChapterRoster();
  const rosterReady = !(roster.isPending && roster.fetchStatus === "fetching");
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

  const key = names.join("\n");
  const done = prepared ? finished.get(prepared) : undefined;
  const cached = !!done && done.names === key;

  useEffect(() => {
    if (!id || !prepared || !rosterReady || cached) return;
    const controller = new AbortController();
    import("@/lib/backwork-bulk/pdf")
      .then(({ suggestDocumentBoxes }) =>
        suggestDocumentBoxes(prepared.doc, names, controller.signal),
      )
      .then(
        (found) => {
          finished.set(prepared, { names: key, found });
          if (!controller.signal.aborted) setResult({ id, ...found });
        },
        () => {
          if (!controller.signal.aborted) setResult({ id, boxes: {}, textLength: -1 });
        },
      );
    return () => controller.abort();
  }, [id, prepared, rosterReady, names, key, cached]);

  if (id && done && cached) return { id, ...done.found };
  return result?.id === id ? result : null;
}
