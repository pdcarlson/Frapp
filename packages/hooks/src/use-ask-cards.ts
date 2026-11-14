"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAiSuggestions, type AiSuggestion } from "./use-ai-suggestions";
import { useViewerUserId } from "./use-user";

/**
 * The cards under an Ask answer (#4904, `spec/behavior/ai.md` § Ask Frapp):
 * the suggestions `answer.proposals` names, read from the asker's own waiting
 * requests (`GET /v1/ai/suggestions` for source `request`, whose id is the
 * asker). There is no route for one suggestion by id.
 *
 * Pass only the ids still waiting on this screen. `settled` turns true once
 * the list has been read since those ids were asked for, so a card that is
 * still missing then has stopped waiting (decided elsewhere, or a day
 * passed) and is not merely on its way.
 */
export function useAskCards(ids: readonly string[]): {
  byId: ReadonlyMap<string, AiSuggestion>;
  settled: boolean;
} {
  const me = useViewerUserId();
  const wanted = ids.length > 0;
  const query = useAiSuggestions({
    source: { type: "request", id: me ?? "" },
    enabled: wanted && !!me,
  });
  const byId = useMemo(() => {
    const map = new Map<string, AiSuggestion>();
    for (const item of query.data?.items ?? []) {
      if (ids.includes(item.id)) map.set(item.id, item);
    }
    return map;
  }, [query.data, ids]);

  // The list may have been cached before this answer made its cards: read it
  // again, once, for each set of ids that is not all there.
  const missing = ids.filter((id) => !byId.has(id)).join(",");
  const asked = useRef<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const { refetch, isFetching, isFetched } = query;
  useEffect(() => {
    if (!missing || !isFetched || isFetching) return;
    if (asked.current === missing) return;
    asked.current = missing;
    void refetch().finally(() => setChecked(missing));
  }, [missing, isFetched, isFetching, refetch]);

  const settled =
    wanted && isFetched && !isFetching && (!missing || checked === missing);
  return { byId, settled };
}
