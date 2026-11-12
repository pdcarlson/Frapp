"use client";

import { useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ACTION_BAR_BUTTON,
  ACTION_BAR_BUTTON_ON,
  CHIP,
  CHIP_HIT_AREA,
} from "./chip";
import { ReactionGlyph } from "./chat-glyphs";
import { EmojiPicker, preloadEmojiPicker } from "./emoji-picker";
import { cn } from "@/lib/utils";
import {
  actionTypeFromEmoji,
  emojiFromActionType,
  type ReactionState,
} from "@repo/chat-core/types";
import { QUICK_REACTIONS, canonicalEmoji } from "@repo/chat-core/emoji-recent";
import { recordRecentEmoji } from "@/lib/chat/recent-emoji";

interface ReactionBarProps {
  reactions: ReactionState;
  /**
   * The viewer's `users.id`, known — `MessageItem` is the only caller and it is
   * now reached only once identity has resolved (#2243).
   *
   * Non-nullable for the same reason the row's own prop is: a nullable viewer
   * made `mine` below confidently `false`, so a chip the viewer had in fact
   * reacted to drew unlit, unpressed, and labelled "Click to react."
   *
   * What that cost is *not* a duplicate reaction, and the distinction matters
   * because two layers already prevent one. `react()` in
   * `@repo/chat-core`'s `chat-client.ts` opens with `if (!ctx.userId) return`,
   * and `ctx.userId` is this same unresolved viewer — so in that window the
   * click was a silent no-op. Even with an id, the server inserts against a
   * unique index on `(message_id, user_id, action_type)` and turns the conflict
   * into `{ deduplicated: true }`. The defect was a chip that misreported the
   * viewer's own state and then did nothing when pressed.
   */
  viewerId: string;
  onReact: (emoji: string) => void;
  onUnreact: (emoji: string) => void;
}

/**
 * Reaction chips under a message — `components.md` §11: 6px below its body,
 * 6px apart, and the reacted chip is §5's Accent badge while the
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
}: ReactionBarProps) {
  const entries = Object.entries(reactions)
    .map(([actionType, userIds]) => ({
      actionType,
      emoji: emojiFromActionType(actionType),
      userIds,
    }))
    .filter(
      (
        group,
      ): group is { actionType: string; emoji: string; userIds: string[] } =>
        group.emoji != null && group.userIds.length > 0,
    );
  if (entries.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {entries.map((group) => {
        const mine = group.userIds.includes(viewerId);
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
 * The action bar's reaction half: four quick reactions plus the full picker.
 *
 * Icon buttons, like the rest of the bar (`ACTION_BAR_BUTTON`), not the 26px
 * reaction chips under the message: these are controls in a toolbar-like
 * strip, and a reaction the viewer already made shows as on
 * (`ACTION_BAR_BUTTON_ON`) so a second press reads as the undo it is.
 */
export function ReactionQuickPick({
  reactions,
  viewerId,
  onReact,
  onUnreact,
}: ReactionBarProps) {
  const [open, setOpen] = useState(false);
  // Whether the picker's last input was a pointer, for its close below.
  const pointerInPicker = useRef(false);
  return (
    <>
      {QUICK_REACTIONS.map((emoji) => {
        const mine = (reactions[actionTypeFromEmoji(emoji)] ?? []).includes(
          viewerId,
        );
        return (
          <button
            key={emoji}
            type="button"
            className={cn(ACTION_BAR_BUTTON, mine && ACTION_BAR_BUTTON_ON)}
            aria-pressed={mine}
            aria-label={`React with ${emoji}`}
            title={`React with ${emoji}`}
            onClick={() => {
              if (mine) return onUnreact(emoji);
              onReact(emoji);
              recordRecentEmoji(emoji);
            }}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={ACTION_BAR_BUTTON}
            aria-label="Open emoji picker"
            title="More reactions"
            onPointerEnter={preloadEmojiPicker}
            onFocus={preloadEmojiPicker}
          >
            <ReactionGlyph className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0"
          align="end"
          onPointerDown={() => {
            pointerInPicker.current = true;
          }}
          onKeyDown={() => {
            pointerInPicker.current = false;
          }}
          // A pick closes the picker from inside it, so Radix hands focus back
          // to the trigger by script. The picker's search field had focus (a
          // text field always matches `:focus-visible`, and an emoji cell keeps
          // focus there on pointerdown), and a script focus away from a ringed
          // element can inherit the ring (WebKit's rule; headless Chromium did
          // not, 2026-11-06). The row's `:focus-visible` reveal would then
          // hold the action bar on screen after a mouse pick, once the pointer
          // has left. A keyboard pick still returns focus to the trigger.
          onCloseAutoFocus={(event) => {
            if (!pointerInPicker.current) return;
            pointerInPicker.current = false;
            event.preventDefault();
          }}
        >
          <EmojiPicker
            onPick={(emoji) => {
              setOpen(false);
              // The spelling already on the message or in the quick row, so
              // a pick joins that chip rather than starting a twin: the
              // catalog writes thumbs up as `👍️` (U+FE0F), the row as `👍`.
              const spelled = canonicalEmoji(emoji, [
                ...Object.keys(reactions).flatMap((type) => {
                  const e = emojiFromActionType(type);
                  return e ? [e] : [];
                }),
                ...QUICK_REACTIONS,
              ]);
              onReact(spelled);
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
