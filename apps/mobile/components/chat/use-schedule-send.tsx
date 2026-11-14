import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Keyboard } from "react-native";
import { useFocusEffect } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  formatScheduledFor,
  useScheduledMessages,
  useScheduleMessage,
} from "@repo/hooks";
import type { MentionPick } from "@repo/validation";
import { scheduledLine } from "@/lib/chat/schedule-send";
import { ScheduleSendSheet } from "./schedule-send-sheet";
import { ScheduledMessagesSheet } from "./scheduled-messages-sheet";

/**
 * The thread's scheduled messages (#4956): Schedule message, opened from a
 * long press on Send, and the Scheduled list behind the line above the
 * composer. The thread passes what it already knows (the draft, its picks,
 * why it can't be scheduled) and gets back what the composer takes.
 *
 * What the sheet schedules is the draft as it stood when the sheet opened, in
 * the channel it opened in: `chat-thread` stays mounted while `channelId`
 * changes in place, so a sheet left up across a switch must not post
 * #general's draft in #dues. The draft clears once the message is scheduled,
 * unless the member has typed since.
 */
export function useScheduleSend({
  channelId,
  enabled,
  draft,
  refusal,
  picksFor,
  clearDraft,
}: {
  channelId: string | null;
  /** The member may post here (not the audit log, not a who-can-post list). */
  enabled: boolean;
  draft: string;
  /** Why the draft can't be scheduled now (`scheduleRefusal`), or `null`. */
  refusal: string | null;
  picksFor: (text: string) => MentionPick[];
  clearDraft: () => void;
}): {
  openSchedule: (() => void) | undefined;
  scheduled: { label: string; failed: number; onOpen: () => void } | null;
  sheets: ReactNode;
} {
  const scheduleRef = useRef<BottomSheetModal>(null);
  const listRef = useRef<BottomSheetModal>(null);
  const list = useScheduledMessages(enabled ? channelId : null);
  const create = useScheduleMessage();
  // What the open sheet schedules, and why it can't, as they stood on the
  // long press.
  const [target, setTarget] = useState<{
    channelId: string;
    text: string;
    refusal: string | null;
  } | null>(null);
  // The draft and channel on screen when a schedule lands, which may not be
  // the ones it was opened on.
  const shownRef = useRef({ channelId, draft });
  useLayoutEffect(() => {
    shownRef.current = { channelId, draft };
  }, [channelId, draft]);

  const openSchedule = useCallback(() => {
    if (!channelId) return;
    Keyboard.dismiss();
    setTarget({ channelId, text: draft.trim(), refusal });
    scheduleRef.current?.present();
  }, [channelId, draft, refusal]);

  const openList = useCallback(() => {
    Keyboard.dismiss();
    listRef.current?.present();
  }, []);

  const schedule = useCallback(
    async (at: Date) => {
      if (!target) return;
      await create.mutateAsync({
        channelId: target.channelId,
        content: target.text,
        sendAt: at,
        mentionPicks: picksFor(target.text),
      });
      const shown = shownRef.current;
      if (
        shown.channelId === target.channelId &&
        shown.draft.trim() === target.text
      ) {
        clearDraft();
      }
      AccessibilityInfo.announceForAccessibility(
        `Scheduled for ${formatScheduledFor(at, new Date())}`,
      );
    },
    [clearDraft, create, picksFor, target],
  );

  // Leaving the channel closes both, as the + sheet's forms close.
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      return () => {
        scheduleRef.current?.dismiss();
        listRef.current?.dismiss();
      };
    }, [channelId]),
  );

  const line = enabled ? scheduledLine(list.data ?? [], new Date()) : null;

  const sheets = (
    <>
      <ScheduleSendSheet
        ref={scheduleRef}
        preview={target?.text ?? ""}
        refusal={target?.refusal ?? null}
        onSchedule={schedule}
      />
      <ScheduledMessagesSheet
        ref={listRef}
        channelId={enabled ? channelId : null}
      />
    </>
  );

  return {
    openSchedule: enabled && channelId ? openSchedule : undefined,
    scheduled: line ? { ...line, onOpen: openList } : null,
    sheets,
  };
}
