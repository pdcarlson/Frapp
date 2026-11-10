"use client";

import {
  ALWAYS_FORMAL_DESCRIPTION,
  ALWAYS_FORMAL_LABEL,
  CHANNEL_DISPLAY_LOCKED_NOTE,
  channelDensityChoices,
  type ChatDensity,
} from "@repo/chat-core/density";
import {
  setChannelDensity,
  useChannelDensityOverride,
  useChannelDisplayLocked,
  useChatDensity,
} from "@/lib/chat/chat-density";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** The channel's Always formal switch, for its creator or an officer (#3787). */
export type ChannelDisplayLockControl = {
  saving: boolean;
  onChange: (locked: boolean) => void;
};

/**
 * The channel menu's Display view (#3787, the #3779 proposal): this channel
 * follows the member's default display, or is pinned to Cozy, Compact or
 * Bubbles here. Per browser, like the default it overrides
 * (`components.md` §11 § Density). Same row recipe as the notification
 * level, and it saves on the click.
 *
 * A channel set to Always formal draws the formal display for everyone, so
 * the choices are shown but can't be picked, under a line saying why. The
 * channel's creator and `channels:manage` holders also get the switch
 * (`lockControl`).
 */
export function ChannelDisplayPanel({
  channelId,
  onChange,
  lockControl,
}: {
  channelId: string;
  onChange: () => void;
  lockControl?: ChannelDisplayLockControl;
}) {
  const fallback = useChatDensity();
  const override = useChannelDensityOverride(channelId);
  const locked = useChannelDisplayLocked(channelId);
  return (
    <>
      {lockControl ? (
        <div className="flex items-start gap-3 border-b border-border px-3 py-3">
          <div className="min-w-0 flex-1">
            <p
              id="channel-always-formal-label"
              className="text-label font-semibold text-foreground"
            >
              {ALWAYS_FORMAL_LABEL}
            </p>
            <p className="text-caption text-muted-foreground">
              {ALWAYS_FORMAL_DESCRIPTION}
            </p>
          </div>
          <Switch
            aria-labelledby="channel-always-formal-label"
            checked={locked}
            disabled={lockControl.saving}
            onCheckedChange={(next) => lockControl.onChange(next)}
          />
        </div>
      ) : null}
      <div className="border-b border-border px-3 py-3">
        <p className="text-caption text-muted-foreground">
          {locked
            ? CHANNEL_DISPLAY_LOCKED_NOTE
            : "Applies to this channel on this browser."}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {channelDensityChoices(fallback).map((choice) => {
          const selected = !locked && choice.value === override;
          return (
            <li key={choice.value ?? "default"}>
              <button
                type="button"
                disabled={locked}
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
                  locked
                    ? "cursor-not-allowed text-muted-foreground"
                    : selected
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
