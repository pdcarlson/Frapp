"use client";

import { useState } from "react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmojiPicker } from "./emoji-picker";
import {
  actionTypeFromEmoji,
  emojiFromActionType,
  type ReactionState,
} from "@repo/chat-core/types";

const QUICK_REACTIONS: readonly string[] = ["👍", "🙏", "✅", "🔥"] as const;

interface ReactionBarProps {
  reactions: ReactionState;
  viewerId: string | null;
  onReact: (emoji: string) => void;
  onUnreact: (emoji: string) => void;
  /** Render compact chips (existing reactions) vs the full quick-pick row. */
  variant?: "chips" | "picker";
}

/**
 * Renders existing reaction chips with `aria-pressed` reflecting whether the
 * viewer is a member of the reaction's user set. Used by message rows for
 * both the persistent chip strip below the body and the hover quick-pick.
 */
export function ReactionChips({
  reactions,
  viewerId,
  onReact,
  onUnreact,
}: Omit<ReactionBarProps, "variant">) {
  const entries = Object.entries(reactions)
    .map(([actionType, userIds]) => ({
      actionType,
      emoji: emojiFromActionType(actionType),
      userIds,
    }))
    .filter(
      (group): group is { actionType: string; emoji: string; userIds: string[] } =>
        group.emoji != null && group.userIds.length > 0,
    );
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {entries.map((group) => {
        const mine = viewerId ? group.userIds.includes(viewerId) : false;
        return (
          <button
            key={group.actionType}
            type="button"
            aria-pressed={mine}
            aria-label={`${group.emoji} reaction, ${group.userIds.length}${
              mine ? ", including you" : ""
            }. ${mine ? "Click to remove." : "Click to react."}`}
            onClick={() =>
              mine ? onUnreact(group.emoji) : onReact(group.emoji)
            }
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition ${
              mine
                ? "border-accent-border bg-accent-subtle text-accent-text"
                : "border-border bg-background hover:bg-accent"
            }`}
          >
            <span>{group.emoji}</span>
            <span className="tabular-nums text-[10px]">{group.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Quick-pick row revealed on hover, plus the "more emoji" popover that opens
 * the full `frimousse` picker.
 */
export function ReactionQuickPick({
  reactions,
  viewerId,
  onReact,
  onUnreact,
}: Omit<ReactionBarProps, "variant">) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      {QUICK_REACTIONS.map((emoji) => {
        const mine = viewerId
          ? (reactions[actionTypeFromEmoji(emoji)] ?? []).includes(viewerId)
          : false;
        return (
          <Button
            key={emoji}
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-base"
            aria-pressed={mine}
            aria-label={`React with ${emoji}`}
            onClick={() => (mine ? onUnreact(emoji) : onReact(emoji))}
          >
            {emoji}
          </Button>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            aria-label="Open emoji picker"
          >
            <Smile className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <EmojiPicker
            onPick={(emoji) => {
              setOpen(false);
              onReact(emoji);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
