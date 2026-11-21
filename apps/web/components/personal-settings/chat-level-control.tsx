"use client";

import { useChapterChatLevel, useSetChapterChatLevel } from "@repo/hooks";
import {
  CHAT_CHAPTER_LEVEL_OPTIONS,
  type ChatChapterLevel,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_OFFSET_HAS_VISIBLE } from "@/components/ui/focus";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import { cn, getErrorMessage } from "@/lib/utils";

const LEGEND_ID = "chat-level-legend";
const NOTE_ID = "chat-level-note";

/**
 * Settings → Chapter alerts → Chat messages, on web (#4124, the web half of
 * #3840): the member's chapter-wide chat level, "All messages" or "Mentions
 * and DMs only". Slack's "Mentions & DMs only" and Discord's server-wide "Only
 * @mentions" are the same choice. The phone's is the s16 row and its
 * `ChatLevelSheet`; the words for both come from `@repo/validation`.
 *
 * Two options, no Off: the owner dropped the switch that silenced all of chat
 * on 2026-11-06, and Shawn kept that on 2026-11-11.
 *
 * Native radios inside their labels, as `ChatDensityControl` does, so the
 * group gets one tab stop and arrow keys from the browser. A pick saves at
 * once. Nothing is checked until the level is read: checking "All messages"
 * as a stand-in would state a level the server may not hold, and a click on
 * it would then be swallowed as a no-op.
 */
export function ChatLevelControl() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const levelQuery = useChapterChatLevel();
  const setLevel = useSetChapterChatLevel();
  const level = levelQuery.data;
  const unknown = level === undefined;
  // While the write is in flight the pending level shows as checked, so the
  // radio moves at the click rather than after the round trip. A failure
  // drops `variables` back to the server's level and says so in a toast.
  const shown: ChatChapterLevel | undefined = setLevel.isPending
    ? setLevel.variables
    : level;

  function pick(next: ChatChapterLevel) {
    if (unknown || next === shown || setLevel.isPending) return;
    if (isOffline) {
      // Refused, not queued: see the switches' `aria-disabled` note in
      // `chapter-alerts-section.tsx`.
      toast({
        title: "You're offline",
        description:
          "Reconnect to change your chat notifications. Nothing has been changed.",
      });
      return;
    }
    setLevel.mutateAsync(next).catch((error: unknown) =>
      toast({
        title: "Couldn't change chat notifications",
        description: getErrorMessage(
          error,
          "Your setting is unchanged. Try again or check your connection.",
        ),
        variant: "destructive",
      }),
    );
  }

  let note: React.ReactNode = null;
  if (levelQuery.isError && unknown) {
    note = (
      <span className="flex flex-wrap items-center gap-2">
        Couldn&apos;t load this setting.
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void levelQuery.refetch()}
        >
          Retry
        </Button>
      </span>
    );
  } else if (isOffline && unknown) {
    note = "Reconnect to load this setting.";
  } else if (isOffline) {
    note = "You're offline, so this can't be changed right now.";
  }

  return (
    <fieldset
      className="grid gap-2"
      aria-labelledby={LEGEND_ID}
      aria-describedby={note ? NOTE_ID : undefined}
      aria-busy={levelQuery.isLoading || setLevel.isPending || undefined}
    >
      <legend id={LEGEND_ID} className="text-sm font-medium text-foreground">
        Chat messages
      </legend>
      <div className="grid gap-2">
        {CHAT_CHAPTER_LEVEL_OPTIONS.map((option) => {
          const checked = option.level === shown;
          return (
            <label
              key={option.level}
              className={cn(
                "flex gap-3 rounded-lg border p-3 transition",
                FOCUS_RING_OFFSET_HAS_VISIBLE,
                unknown ? "cursor-default opacity-60" : "cursor-pointer",
                checked
                  ? "border-accent-border bg-accent-subtle-hover"
                  : "border-border hover:bg-card-hover",
              )}
            >
              <input
                type="radio"
                name="chat-chapter-level"
                value={option.level}
                checked={checked}
                disabled={unknown}
                aria-disabled={isOffline || undefined}
                onChange={() => pick(option.level)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="grid content-start gap-0.5">
                <span
                  className={cn(
                    "text-sm font-semibold",
                    checked ? "text-accent-text" : "text-foreground",
                  )}
                >
                  {option.label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        A channel or DM you set yourself keeps its own setting.
      </p>
      {note ? (
        <p id={NOTE_ID} className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}
