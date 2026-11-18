"use client";

import type { CSSProperties } from "react";
import { ASK_COPY } from "@repo/validation";
import { signetGlass } from "@repo/theme/glass";
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
 * It floats at the bottom of the tool page (`dashboard-shell.tsx`), and with
 * chat alone at the bottom of the Channels column (`chat-shell.tsx`), never
 * over a message box: the composer owns the bottom of a channel, and asks
 * there through `@Frapp` (#4713). From #4904 (2026-11-13) until this the
 * top bar's search field asked too; Shawn and Paul didn't want Ask in the
 * search bar.
 *
 * Only for a member with Ask (`useAskEntry`); anyone else gets nothing.
 */

/** What the bar opens, for a screen reader. */
export const ASK_BAR_DESCRIPTION = "Ask a question about your chapter";

/**
 * The glass recipe (`signetGlass`, foundations.md § Glass) over the nav
 * step, with the edge in the chapter's colour as the phone's bar draws it.
 */
const GLASS: CSSProperties = {
  backgroundColor: `color-mix(in srgb, var(--surface-1) ${signetGlass.fillAlpha * 100}%, transparent)`,
  backgroundImage: `linear-gradient(to bottom, rgba(255,255,255,${signetGlass.specular}), transparent ${signetGlass.specularStop * 100}%)`,
  backdropFilter: `blur(${signetGlass.blur}px)`,
  WebkitBackdropFilter: `blur(${signetGlass.blur}px)`,
  borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
};

export function AskBar({
  className,
  compact = false,
}: {
  className?: string;
  /**
   * For a narrow column (the Channels list's 330px), where the field's words
   * would be cut: the bar reads "Ask Frapp" instead.
   */
  compact?: boolean;
}) {
  const ask = useAskEntry();
  if (!ask) return null;
  return (
    <button
      type="button"
      // Where the conversation returns focus when it closes (`ask-card.tsx`).
      data-ask-entry=""
      aria-label={ASK_COPY.name}
      aria-description={ASK_BAR_DESCRIPTION}
      aria-haspopup="dialog"
      aria-expanded={ask.open}
      onClick={(event) => ask.openWith(event.currentTarget)}
      style={GLASS}
      className={cn(
        // The Default control step (48), fully round, as the phone's bar.
        "flex h-12 w-full items-center gap-3 rounded-full border pl-[18px] pr-2 text-left transition hover:brightness-125",
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
        <AskSendGlyph />
      </span>
    </button>
  );
}

/**
 * The phone's send arrow (`AskSendGlyph` in the mobile `ask-bar.tsx`,
 * transcribed from `canvas-screens.dc.html` s17), so the two bars carry one
 * mark.
 */
function AskSendGlyph() {
  return (
    <svg
      viewBox="0 0 17 17"
      className="h-4 w-4 text-primary"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2.5 8.5h9M8 3.5l6 5-6 5"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
