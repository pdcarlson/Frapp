"use client";

import { connectionIndicator } from "@repo/validation";
import { useOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { useNetwork } from "@/lib/providers/network-provider";
import { cn } from "@/lib/utils";
import { FOCUS_RING_ALWAYS } from "@/components/ui/focus";
import { CONNECTION_PILL_ATTR } from "@/components/shared/connection-pill-focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The one connection indicator (`spec/ui/resilience/connection-state.md`
 * § One indicator), the same pattern mobile draws.
 *
 * A small pill: a dot in the state's color and a short label ("Offline",
 * "Slow connection", "Reconnecting…", "Live updates paused"). The whole
 * sentence is its accessible name and its hover title, and a click or tap
 * opens it in a popover, which is how a touch screen with no hover reads it. What it says comes
 * from `connectionIndicator` in `@repo/validation`, which folds the app's
 * connection state and the open chat's realtime transport into one answer.
 *
 * ## Why one
 *
 * Offline used to show three times on a chat screen (2026-11-06, Paul): this
 * component as a red toast floating over the channel header, the chat's own
 * "Offline — messages will send when you reconnect" pill in that header, and a
 * line under the composer saying it a third time. A slow connection stacked
 * "Slow connection" over the chat's "Reconnecting…" the same way. Now a chat
 * reports its transport (`useReportOpenChatTransport`) instead of drawing it,
 * and this pill says whichever one thing is true.
 *
 * ## Where it sits
 *
 * `top-bar`: in the dashboard's top bar, before the notifications bell. It
 * floated below the bar until 2026-11-06 (#2244), which kept it out of the
 * layout but put it over the first row of every page, chat's channel header
 * included. In the bar it covers nothing. It draws its label only from `xl`,
 * where the right cell (`flex-1`, `justify-end`) has room for it beside the
 * bell, Ask and the avatar: at 1024px a chat-width bar gives that cell about
 * 245px, too little for a 130px label too. Below `xl` it draws the dot alone,
 * in a 28px slot the top bar keeps whether or not there is anything to say,
 * so a state that flaps never resizes the find field or the title. The
 * sentence is a click or tap away at every width.
 *
 * `floating`: mounted by the root layout for the routes with no bar (sign-in,
 * onboarding), a fixed pill at the top of the viewport that takes no pointer.
 * It hides itself whenever the dashboard shell is mounted, through the same
 * `:has()` rule that used to move it under the bar, so the two never show at
 * once and only one is in the accessibility tree.
 *
 * No dismiss control any more: the pill covers nothing in the bar, and the
 * floating one lets every tap outside the pill through.
 */
export function ConnectionPill({
  placement = "floating",
}: {
  placement?: "floating" | "top-bar";
}) {
  const { state } = useNetwork();
  const transport = useOpenChatTransport();
  const indicator = connectionIndicator(state, transport);
  if (!indicator) return null;

  const pill = (
    <>
      {/*
        The announcement. Its own node, so the control below can be a real
        button: a member using a screen reader needs to know a write is about
        to fail as much as a sighted one does.
      */}
      <span role="alert" aria-live="polite" className="sr-only">
        {indicator.description}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            {...{ [CONNECTION_PILL_ATTR]: "" }}
            aria-label={indicator.description}
            title={indicator.description}
            className={cn(
              "pointer-events-auto flex h-7 max-w-full shrink-0 items-center gap-2 rounded-full border border-border bg-popover px-2.5 text-caption text-foreground animate-slide-down hover:bg-card-hover",
              FOCUS_RING_ALWAYS,
              placement === "top-bar" &&
                "max-xl:w-7 max-xl:justify-center max-xl:px-0",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                indicator.tone === "danger" ? "bg-destructive" : "bg-warning",
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                "truncate font-medium",
                placement === "top-bar" && "max-xl:hidden",
              )}
            >
              {indicator.label}
            </span>
          </button>
        </PopoverTrigger>
        {/* The sentence, a tap away on a touch screen with no hover title. */}
        <PopoverContent align="end" className="w-64">
          <p className="text-caption text-foreground">
            {indicator.description}
          </p>
        </PopoverContent>
      </Popover>
    </>
  );

  if (placement === "top-bar") return pill;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-40 flex justify-center px-4 [html:has([data-dashboard-shell])_&]:hidden">
      {pill}
    </div>
  );
}
