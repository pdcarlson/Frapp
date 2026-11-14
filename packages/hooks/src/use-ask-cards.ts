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
 * the list has been read, and read well, since those ids were asked for: a
 * card still missing then has stopped waiting (decided elsewhere, or a day
 * passed) and is not merely on its way. It stays true through later reads of
 * the list, so a line already shown does not flicker. `failed` says the list
 * could not be read, which is not the same as a card being gone.
 */
export function useAskCards(ids: readonly string[]): {
  byId: ReadonlyMap<string, AiSuggestion>;
  settled: boolean;
  failed: boolean;
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
  // again, once, for each set of ids that is not all there. Only a read that
  // worked says a card is gone.
  const missing = ids.filter((id) => !byId.has(id));
  const missingKey = missing.join(",");
  const asked = useRef<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const { refetch, isFetching, isSuccess, isError } = query;
  useEffect(() => {
    if (!missingKey || !isSuccess || isFetching) return;
    if (asked.current === missingKey) return;
    asked.current = missingKey;
    void refetch().then((result) => {
      if (!result.isSuccess) {
        asked.current = null;
        return;
      }
      const held = new Set(result.data.items.map((item) => item.id));
      setGone((now) => {
        const next = new Set(now);
        for (const id of missingKey.split(",")) {
          if (!held.has(id)) next.add(id);
        }
        return next;
      });
    });
  }, [missingKey, isSuccess, isFetching, refetch]);

  const settled = wanted && missing.every((id) => gone.has(id));
  return { byId, settled, failed: isError && !settled };
}
