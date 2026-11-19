"use client";

import { ASK_COPY } from "@repo/validation";
import { ASK_SEND_GLYPH } from "@repo/theme/crest";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { useAskEntry } from "./ask-host";
import { FrappCrest } from "./frapp-crest";

/**
 * Ask Frapp's front door on web (#5476, Paul's pick of 2026-11-18): the
 * phone's floating Ask bar (`apps/mobile/components/ask/ask-bar.tsx`) brought
 * to the dashboard, so a member meets the same door on both. A glass capsule
 * with the crest in the chapter's colour, the conversation's own words
 * ("Ask Frapp anything") and its send arrow at the end, so it reads as the
 * field it opens rather than as a banner. A click opens the conversation
 * (`ask-card.tsx`) and focus comes back here when it closes.
 *
 * From the nav column's width up (`lg`) it has one home on every layout: the
 * foot of the sidebar (`app-nav.tsx`), above Collapse sidebar, and the crest
 * alone in the rail (#5560, Paul's pick of 2026-11-19). It used to float in
 * whichever column was open, so it moved as panes opened and closed (Shawn,
 * 2026-11-18) and covered the last row of any page with its own scroll box.
 * Below `lg` the shell is a single page with no sidebar, so it floats at the
 * bottom of that page (`dashboard-shell.tsx`) or of chat's Channels list
 * (`chat-shell.tsx`), never over a message box: the composer owns the bottom
 * of a channel and asks there through `@Frapp` (#4713). Shawn and Paul
 * didn't want Ask in the top bar's search field (#4904 until #5476).
 *
 * Its name is its words ("Ask Frapp anything", or "Ask Frapp" compact), so
 * what a voice-control user reads on it is what it answers to (WCAG 2.5.3).
 *
 * Only for a member with Ask (`useAskEntry`); anyone else gets nothing.
 */

/**
 * The glass recipe (`signetGlass` in `@repo/theme/glass`; foundations.md
 * § Glass), spelled as classes so it can carry the Reduce Transparency
 * fallback, as the dialog and sheet scrims spell their blur: `surface-1` at
 * 56% over a 26px blur, the sheen white at 7% gone by 46%. Its edge is the
 * chapter's colour at 30%, as the phone's bar draws it. With Reduce
 * Transparency on it is plain `surface-1` with the hairline, nothing
 * see-through. A change to `signetGlass` moves these with it. Arbitrary
 * properties rather than `bg-[…]`, so `cn` doesn't merge the fill and the
 * sheen into one.
 */
const GLASS = [
  "[border-color:color-mix(in_srgb,var(--primary)_30%,transparent)]",
  "[background-color:color-mix(in_srgb,var(--surface-1)_56%,transparent)]",
  "[background-image:linear-gradient(to_bottom,rgba(255,255,255,0.07),transparent_46%)]",
  "backdrop-blur-[26px]",
  "[@media(prefers-reduced-transparency:reduce)]:[border-color:var(--border)]",
  "[@media(prefers-reduced-transparency:reduce)]:[background-color:var(--surface-1)]",
  "[@media(prefers-reduced-transparency:reduce)]:[background-image:none]",
  "[@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none",
].join(" ");

export function AskBar({
  className,
  compact = false,
  rail = false,
}: {
  className?: string;
  /**
   * For the collapsed sidebar's 56px rail: the crest alone in a 34px round
   * button, as the rail's rows are, its name in the label and the tooltip.
   */
  rail?: boolean;
  /**
   * For the Channels column (240px from `lg` up), where the field's words
   * would be cut: the bar reads "Ask Frapp" instead.
   */
  compact?: boolean;
}) {
  const ask = useAskEntry();
  if (!ask) return null;
  if (rail) {
    return (
      <button
        type="button"
        data-ask-entry=""
        aria-haspopup="dialog"
        aria-expanded={ask.open}
        aria-label={ASK_COPY.name}
        title={ASK_COPY.name}
        onClick={(event) => ask.openWith(event.currentTarget)}
        className={cn(
          "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full border transition hover:brightness-125",
          GLASS,
          FOCUS_RING_SHELL,
          className,
        )}
      >
        <FrappCrest className="h-[18px] w-[15px] text-primary" />
      </button>
    );
  }
  return (
    <button
      type="button"
      // Where the conversation returns focus when it closes (`ask-card.tsx`).
      data-ask-entry=""
      aria-haspopup="dialog"
      aria-expanded={ask.open}
      onClick={(event) => ask.openWith(event.currentTarget)}
      className={cn(
        // The Default control step (48), fully round, as the phone's bar.
        "flex h-12 w-full items-center gap-3 rounded-full border pl-[18px] pr-2 text-left transition hover:brightness-125",
        GLASS,
        FOCUS_RING_SHELL,
        className,
      )}
    >
      <FrappCrest className="h-[22px] w-[18px] shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">
        {compact ? ASK_COPY.name : ASK_COPY.placeholder}
      </span>
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-subtle"
      >
        <svg
          viewBox={ASK_SEND_GLYPH.viewBox}
          className="h-4 w-4 text-primary"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={ASK_SEND_GLYPH.path}
            stroke="currentColor"
            strokeWidth={ASK_SEND_GLYPH.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}
