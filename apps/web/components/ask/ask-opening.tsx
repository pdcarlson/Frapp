"use client";

import { useEffect, useState } from "react";
import { CornerDownRight } from "lucide-react";
import {
  ASK_STARTER,
  askDayLine,
  askGreeting,
  type AskSuggestion,
} from "@repo/validation";
import { FrappCrest } from "@/components/ask/frapp-crest";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * What Ask opens on before the first turn (#4904; Paul, 2026-11-17), the
 * same as the phone's (`apps/mobile/components/ask/ask-opening.tsx`): the
 * crest in the chapter's colour over a glow of that colour, the day and a
 * greeting, and what this member could ask right now as rows led by an arrow,
 * just above the field. No paragraph about how Ask works: on a member's first
 * open in this browser that is an exchange that already happened instead,
 * "What can you do?" and Frapp's answer, which is our copy and is never sent.
 * Bevel's assistant home and ChatGPT's and Claude's empty screens open the
 * same way.
 */
export function AskOpening({
  displayName,
  starter,
  canAct,
  suggestions,
  onPick,
}: {
  displayName: string | null;
  starter: boolean;
  canAct: boolean;
  suggestions: readonly AskSuggestion[];
  onPick: (suggestion: AskSuggestion) => void;
}) {
  // Read once, so the greeting doesn't change under the member's eyes.
  const [now] = useState(() => new Date());
  return (
    <div className="flex min-h-full flex-col gap-6">
      <div
        className={cn(
          "flex flex-col items-center gap-4 text-center",
          // Room above the crest for its glow, which the scroll area would cut.
          starter ? "pt-12" : "flex-1 justify-center py-14",
        )}
      >
        <span
          className="relative flex items-center justify-center"
          aria-hidden="true"
        >
          <span
            className={cn(
              "ask-glow pointer-events-none absolute rounded-full",
              starter ? "h-40 w-40" : "h-48 w-48",
            )}
          />
          <FrappCrest
            className={cn(
              "relative text-primary",
              starter ? "h-14 w-[47px]" : "h-[72px] w-[60px]",
            )}
          />
        </span>
        <div className="space-y-1">
          {starter ? null : (
            <p className="text-caption text-muted-foreground">
              {askDayLine(now)}
            </p>
          )}
          <p className="text-2xl font-bold leading-8 text-foreground">
            {starter
              ? ASK_STARTER.hello(displayName)
              : askGreeting(now, displayName)}
          </p>
        </div>
      </div>

      {starter ? (
        <div className="flex flex-1 flex-col gap-3">
          {/* The member's bubble, as `ask-answer.tsx` draws a question. */}
          <p className="ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-[6px] bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            {ASK_STARTER.question}
          </p>
          <p className="text-sm text-foreground">{ASK_STARTER.answer}</p>
          {canAct ? (
            <p className="text-sm text-foreground">
              {ASK_STARTER.answer_act}
            </p>
          ) : null}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        // Fades in at the bottom, where nothing sits below it to move.
        <ul className="divide-y divide-border animate-in fade-in duration-300 motion-reduce:animate-none">
          {suggestions.map((suggestion) => (
            <li key={suggestion.text}>
              <button
                type="button"
                onClick={() => onPick(suggestion)}
                className={cn(
                  "flex min-h-11 w-full items-start gap-3 rounded-md px-1 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-card-hover",
                  FOCUS_RING,
                )}
              >
                <CornerDownRight
                  className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{suggestion.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const STARTER_KEY_PREFIX = "frapp.web.ask-starter-seen:";

/**
 * Whether this open carries the first-open starter: once per member in this
 * browser, claimed when Ask opens with an empty thread and held for that
 * open. A browser that can't read or keep the record never shows it, since a
 * starter that can't be remembered would be at the top of every open.
 */
export function useAskStarter({
  userId,
  open,
  empty,
}: {
  userId: string | null;
  open: boolean;
  empty: boolean;
}): boolean {
  // Each open is a new sitting, counted during render, not in an effect.
  const [sitting, setSitting] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSitting((n) => n + 1);
  }
  const [claimedIn, setClaimedIn] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !userId || !empty) return;
    let live = true;
    // After the commit, like the phone's read of its record.
    void Promise.resolve().then(() => {
      if (live && claimAskStarter(userId)) setClaimedIn(sitting);
    });
    return () => {
      live = false;
    };
    // Claimed when Ask opens, not again when the first turn empties it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, sitting]);
  return open && claimedIn === sitting;
}

/** `true` only when the record said unseen and marking it seen went through. */
export function claimAskStarter(
  userId: string,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof window ===
  "undefined"
    ? undefined
    : window.localStorage,
): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(STARTER_KEY_PREFIX + userId) !== null) return false;
    storage.setItem(STARTER_KEY_PREFIX + userId, "1");
    return true;
  } catch {
    return false;
  }
}
