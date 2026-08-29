"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MuteGlyph } from "./chat-glyphs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ChatNotificationLevel } from "@repo/hooks";

/**
 * Per-channel notification level, from the channel header (#296).
 *
 * **Why the header and not the channel row.** The row in `channel-list.tsx` is
 * a single `<button>`; a mute control inside it would be a nested button, which
 * is invalid HTML and does not receive clicks reliably. The alternative —
 * revealing it on row hover — is exactly the defect #1193 tracks for message
 * actions: hover-only controls are unreachable on touch. The header has room,
 * is unambiguous about which channel it acts on, and is where Slack and Discord
 * both put this. The row keeps its `muted` indicator, which this finally
 * populates.
 *
 * The three levels are the schema's, not an invention
 * (`chat_notification_preferences.level`). `mentions` is the default for
 * ordinary channels, so it is labelled as such rather than presented as a third
 * exotic option.
 */

const OPTIONS: {
  level: ChatNotificationLevel;
  label: string;
  description: string;
}[] = [
  {
    level: "all",
    label: "Every message",
    description: "Notify me whenever anyone posts here.",
  },
  {
    level: "mentions",
    label: "Only @mentions",
    description: "The default. Notify me when someone addresses me.",
  },
  {
    level: "off",
    label: "Mute",
    description: "No notifications — but @mentions still reach you.",
  },
];

export function NotificationLevelPopover({
  level,
  onChange,
  disabled,
  isSaving,
}: {
  /** The channel's current level; `mentions` when the user has set nothing. */
  level: ChatNotificationLevel;
  onChange: (level: ChatNotificationLevel) => void;
  disabled?: boolean;
  isSaving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isMuted = level === "off";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          // Names the state, not just the control: a screen reader user needs
          // to know the channel is muted without opening the popover.
          aria-label={
            isMuted
              ? "Notifications: muted. Change notification level"
              : `Notifications: ${level === "all" ? "every message" : "only @mentions"}. Change notification level`
          }
        >
          <MuteGlyph className="h-5 w-5" active={isMuted} />
          {isMuted ? <span>Muted</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <p className="border-b border-border px-3 py-3 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Notify me about
        </p>
        <ul className="divide-y divide-border">
          {OPTIONS.map((option) => {
            const selected = option.level === level;
            return (
              <li key={option.level}>
                <button
                  type="button"
                  disabled={isSaving}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => {
                    // A no-op write still costs a round trip and would bump
                    // updated_at for nothing.
                    if (!selected) onChange(option.level);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                    selected
                      ? "bg-accent-subtle text-accent-text"
                      : "text-foreground hover:bg-card",
                  )}
                >
                  <span className="text-[14.5px] font-semibold">
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "text-[12.5px]",
                      selected ? "text-accent-text" : "text-muted-foreground",
                    )}
                  >
                    {option.description}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
