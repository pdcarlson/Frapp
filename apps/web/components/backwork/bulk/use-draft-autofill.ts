"use client";

import { useEffect, useRef, useState } from "react";
import { codeOf, statusOf } from "@repo/api-sdk";
import { useFillBackworkDraft, type BackworkDraft } from "@repo/hooks";

/** Fills at once: enough to keep up with a queue, light on the spend caps. */
const AT_ONCE = 2;

/** How long to wait after the API says "too many requests". */
const COOLDOWN_MS = 30_000;

/**
 * Why the fill stopped for this visit to the page:
 * - `consent`: the member hasn't said yes to Frapp AI.
 * - `chapter_off`: the president has Frapp AI turned off.
 * - `off`: AI is off on this server. The page says nothing.
 */
export type DraftAutofillStop = "consent" | "chapter_off" | "off";

/**
 * Asks the upload AI to fill each redacted draft that hasn't been filled yet
 * (`draft_fields.ai_fill` unset), a couple at a time, as drafts appear
 * (#5233). New drafts from the queue above are picked up as they land in the
 * list, and drafts from an earlier visit are filled too.
 *
 * A draft uploaded as-is is never sent: its stored file is the original, and
 * the API refuses it too. Nor is one whose pages wait for its uploader's check
 * (#5252); it is filled once they have checked them. A draft is asked about
 * once per visit: a refusal or a bad answer leaves it as it was, for the
 * member to fill by hand. A 429 (too many fills this minute) or a 409 (a fill
 * of that draft is still running, from another tab or a request whose answer
 * was lost) puts it back in line and pauses the fill for a moment, so the
 * draft is asked about again rather than left unfilled for the visit. A 403
 * or a 404 for AI stops every fill, since the next answer would be the same.
 */
export function useDraftAutofill(drafts: readonly BackworkDraft[], enabled: boolean) {
  const fill = useFillBackworkDraft();
  const mutate = fill.mutateAsync;
  const tried = useRef(new Set<string>());
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [stopped, setStopped] = useState<DraftAutofillStop | null>(null);
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [coolingDown]);

  useEffect(() => {
    if (!enabled || stopped || coolingDown) return;
    const room = AT_ONCE - running.size;
    if (room <= 0) return;
    const next = drafts
      .filter(
        (draft) =>
          draft.is_redacted &&
          !draft.draft_fields?.ai_fill &&
          // Saved without anyone looking at its pages (#5252): read only
          // once its uploader has checked them, as the API insists too.
          !draft.draft_fields?.pages_unchecked &&
          !tried.current.has(draft.id),
      )
      .slice(0, room);
    if (next.length === 0) return;

    for (const draft of next) tried.current.add(draft.id);
    setRunning((current) => new Set([...current, ...next.map((draft) => draft.id)]));
    for (const draft of next) {
      mutate(draft.id)
        .catch((error: unknown) => {
          const code = codeOf(error);
          if (code === "ai.consent.required") setStopped("consent");
          else if (code === "ai.chapter_off") setStopped("chapter_off");
          else if (code === "ai.not_available") {
            setStopped("off");
          } else if (statusOf(error) === 429 || statusOf(error) === 409) {
            // Too many fills this minute, or this draft's fill still running:
            // ask again after the pause.
            tried.current.delete(draft.id);
            setCoolingDown(true);
          }
          // Anything else (the draft was deleted, a network blip) leaves this
          // one alone and goes on with the rest.
        })
        .finally(() => {
          setRunning((current) => {
            const left = new Set(current);
            left.delete(draft.id);
            return left;
          });
        });
    }
  }, [drafts, enabled, stopped, coolingDown, running, mutate]);

  return { running, stopped };
}
