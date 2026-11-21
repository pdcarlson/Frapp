"use client";

import { useEffect, useState } from "react";
import type { AskOpeningMode, AskStarterStore } from "@repo/hooks";
import { CornerDownRight } from "lucide-react";
import {
  ASK_STARTER,
  askDayLine,
  askGreeting,
  type AskStarterSeen,
  type AskSuggestion,
} from "@repo/validation";
import { AskQuestionBubble } from "@/components/ask/ask-answer";
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
  mode,
  onStarterShown,
  canAct,
  suggestions,
  onPick,
}: {
  displayName: string | null;
  /** From `useAskStarter`: the first open's starter, the greeting, or neither yet. */
  mode: AskOpeningMode;
  /** The starter is on screen: the record may now say it was seen. */
  onStarterShown: () => void;
  canAct: boolean;
  suggestions: readonly AskSuggestion[];
  onPick: (suggestion: AskSuggestion) => void;
}) {
  // Read once, so the greeting doesn't change under the member's eyes.
  const [now] = useState(() => new Date());
  const starter = mode === "starter";
  // Recorded once it is really drawn, and again if what it says changes.
  useEffect(() => {
    if (starter) onStarterShown();
  }, [starter, canAct, onStarterShown]);
  // Nothing while the record is read, so the greeting never flashes first.
  if (mode === "deciding") return <div className="min-h-full" />;
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
              starter ? "h-44 w-44" : "h-56 w-56",
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
          <AskQuestionBubble>{ASK_STARTER.question}</AskQuestionBubble>
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
 * Where this browser remembers that a member has seen the first-open
 * starter, per member. When it is read and written, and what it decides, is
 * `useAskStarter` in `@repo/hooks`, shared with the phone. `localStorage`
 * itself is reached inside the `try`: with site data blocked even reading
 * the property throws.
 */
export function askStarterStore(
  storage: () => Pick<Storage, "getItem" | "setItem"> = () =>
    window.localStorage,
): AskStarterStore {
  return {
    read: async (userId) => {
      try {
        const raw = storage().getItem(STARTER_KEY_PREFIX + userId);
        return raw === "ask" || raw === "act" ? raw : null;
      } catch {
        return undefined;
      }
    },
    write: async (userId, seen: AskStarterSeen) => {
      try {
        storage().setItem(STARTER_KEY_PREFIX + userId, seen);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** This browser's store, one for the app. */
export const ASK_STARTER_STORE = askStarterStore();
