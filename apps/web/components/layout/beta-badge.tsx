"use client";

import { cn } from "@/lib/utils";

export type BetaBadgeStyle =
  | "sidebar_pill"
  | "breadcrumb_pill"
  | "top_banner"
  | "corner_badge";

type BetaBadgeProps = {
  style?: BetaBadgeStyle;
  className?: string;
  label?: string;
};

/*
 * BETA badge for the chat-first redesign. Four styles ship in Chunk 01
 * with the variant hardcoded to `sidebar_pill` at the call site; Chunk 8
 * wires the active style + enabled flag to `chapters.beta_config` so
 * each chapter can choose where they see the badge.
 */
export function BetaBadge({
  style = "sidebar_pill",
  className,
  label = "BETA",
}: BetaBadgeProps) {
  switch (style) {
    case "sidebar_pill":
      return (
        <span
          className={cn(
            "inline-flex items-center rounded-xs border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
            "border-accent-border bg-accent-subtle text-accent-text",
            className,
          )}
        >
          {label}
        </span>
      );
    case "breadcrumb_pill":
      return (
        <span
          className={cn(
            "inline-flex items-center rounded-xs border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
            "border-primary/30 bg-primary/10 text-primary",
            className,
          )}
        >
          {label}
        </span>
      );
    case "top_banner":
      return (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 border-b border-border bg-secondary/60 px-6 py-2 text-xs text-foreground",
            className,
          )}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-primary ring-4 ring-primary/15"
          />
          <span className="font-semibold uppercase tracking-[0.16em]">
            {label}
          </span>
          <span className="text-muted-foreground">
            Public preview — expect rough edges.
          </span>
        </div>
      );
    case "corner_badge":
      return (
        <span
          className={cn(
            "fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground",
            className,
          )}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-primary"
          />
          {label}
        </span>
      );
  }
}
