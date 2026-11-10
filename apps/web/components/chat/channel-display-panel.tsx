"use client";

import {
  channelDensityChoices,
  type ChatDensity,
} from "@repo/chat-core/density";
import {
  setChannelDensity,
  useChannelDensityOverride,
  useChatDensity,
} from "@/lib/chat/chat-density";
import { cn } from "@/lib/utils";

/**
 * The channel menu's Display view (#3787, the #3779 proposal): this channel
 * follows the member's default display, or is pinned to Cozy, Compact or
 * Bubbles here. Per browser, like the default it overrides
 * (`components.md` §11 § Density). Same row recipe as the notification
 * level, and it saves on the click.
 */
export function ChannelDisplayPanel({
  channelId,
  onChange,
}: {
  channelId: string;
  onChange: () => void;
}) {
  const fallback = useChatDensity();
  const override = useChannelDensityOverride(channelId);
  return (
    <>
      <div className="border-b border-border px-3 py-3">
        <p className="text-caption text-muted-foreground">
          Applies to this channel on this browser.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {channelDensityChoices(fallback).map((choice) => {
          const selected = choice.value === override;
          return (
            <li key={choice.value ?? "default"}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                  if (!selected) {
                    setChannelDensity(
                      channelId,
                      choice.value as ChatDensity | null,
                    );
                  }
                  onChange();
                }}
                className={cn(
                  "flex w-full px-3 py-2.5 text-left text-label font-semibold transition-colors",
                  selected
                    ? "bg-accent-subtle text-accent-text"
                    : "text-foreground hover:bg-card-hover",
                )}
              >
                {choice.label}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
