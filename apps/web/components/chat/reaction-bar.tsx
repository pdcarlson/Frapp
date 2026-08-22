"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CHIP, CHIP_HIT_AREA } from "./chip";
import { ReactionGlyph } from "./chat-glyphs";
import { EmojiPicker } from "./emoji-picker";
import { cn } from "@/lib/utils";
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
}

/**
 * Reaction chips attached to a bubble — `components.md` §11: 6px below it,
 * indented 4px, 6px apart, and the reacted chip is §5's Accent badge while the
 * add chip is the same geometry in the elevated step. Both recipes and the
 * 44px hit area live in `./chip.ts`.
 *
 * The pressed paint stays a ternary off the same `mine` boolean that sets
 * `aria-pressed`, deliberately, rather than moving to an
 * `aria-[pressed=true]:` variant. The CSS spelling would guarantee the paint
 * and the attribute cannot diverge, but `CHIP.neutral` already carries
 * `disabled:` rules touching the same properties, and two variants at equal
 * specificity are resolved by Tailwind's own sort order rather than by the
 * order written here — the tie the primitives slice found four of. One
 * expression feeding both the attribute and the class is the version with no
 * tie to lose.
 */
export function ReactionChips({
  reactions,
  viewerId,
  onReact,
  onUnreact,
  align = "start",
}: ReactionBarProps & { align?: "start" | "end" }) {
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
    <div
      className={cn(
        "mx-1 mt-1.5 flex flex-wrap gap-1.5",
        align === "end" && "justify-end",
      )}
    >
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
            className={cn(
              CHIP.base,
              CHIP_HIT_AREA,
              "gap-1",
              mine ? CHIP.accent : CHIP.neutral,
            )}
          >
            <span aria-hidden="true">{group.emoji}</span>
            <span aria-hidden="true" className="tabular-nums">
              {group.userIds.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The hover row: four quick reactions plus the full picker.
 *
 * These are chips, not buttons. §11 draws the add-reaction affordance as a chip
 * at the same 26px height as the reacted ones, and a row of six 44px-tall
 * buttons over a message would outweigh the message. The 44px *hit area* is
 * still met — see `CHIP_HIT_AREA`.
 */
export function ReactionQuickPick({
  reactions,
  viewerId,
  onReact,
  onUnreact,
}: ReactionBarProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      {QUICK_REACTIONS.map((emoji) => {
        const mine = viewerId
          ? (reactions[actionTypeFromEmoji(emoji)] ?? []).includes(viewerId)
          : false;
        return (
          <button
            key={emoji}
            type="button"
            className={cn(
              CHIP.base,
              CHIP_HIT_AREA,
              mine ? CHIP.accent : CHIP.neutral,
            )}
            aria-pressed={mine}
            aria-label={`React with ${emoji}`}
            onClick={() => (mine ? onUnreact(emoji) : onReact(emoji))}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA)}
            aria-label="Open emoji picker"
          >
            <ReactionGlyph className="h-4 w-4" />
          </button>
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
