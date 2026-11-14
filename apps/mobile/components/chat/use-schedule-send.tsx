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
import {
  attachmentRequestBody,
  type OutboxAttachment,
} from "@repo/chat-core/adapters";
import { scheduledLine } from "@/lib/chat/schedule-send";
import { ScheduleSendSheet } from "./schedule-send-sheet";
import { ScheduledMessagesSheet } from "./scheduled-messages-sheet";

/**
 * The thread's scheduled messages (#4956): Schedule message, opened from a
 * long press on Send, and the Scheduled list behind the line above the
 * composer. The thread passes what it already knows (the draft, its picks,
 * why it can't be scheduled) and gets back what the composer takes.
 *
 * **Scheduling needs posting; the list needs only reading.** A message that
 * failed because the member lost posting here is exactly the one they need
 * to see and delete, so the line and the list stay while `canSchedule` is
 * off, as web's bar does (`spec/behavior/chat/README.md` § Scheduled
 * messages).
 *
 * **What the sheet schedules is the draft as it stood on the long press**, in
 * the channel it opened in, with the presets read off the clock at that
 * moment: `chat-thread` stays mounted while `channelId` changes in place and
 * while the phone sleeps, so neither the channel nor the time can come from
 * the screen's own lifetime.
 *
 * **The draft clears on the tap and comes back on a refusal**, as web's
 * composer and an ordinary send do: cleared at once, a channel switch while
 * the request is out can't leave the scheduled text sitting in the composer
 * to be sent a second time. Back on a refusal, into the composer when the
 * channel is still on screen, or into that channel's saved draft when it
 * isn't; either way only where nothing new was typed.
 *
 * **Photos and the reply go with it (#4971)**, as the long press found them:
 * photos already uploaded (the refusal holds one still uploading), and the
 * staged reply. They leave the tray and the strip only once it is scheduled
 * (`onScheduled`), so a refusal leaves them where they were.
 */
export function useScheduleSend({
  channelId,
  canSchedule,
  showList,
  draft,
  refusal,
  picksFor,
  setDraft,
  restoreDraftFor,
  photos = [],
  replyToId = null,
  onScheduled,
}: {
  channelId: string | null;
  /** The member may post here: not the audit log, not off a who-can-post list. */
  canSchedule: boolean;
  /** The member's scheduled messages here can be listed: any readable channel. */
  showList: boolean;
  draft: string;
  /** Why the draft can't be scheduled now (`scheduleRefusal`), or `null`. */
  refusal: string | null;
  picksFor: (text: string) => MentionPick[];
  /** Sets the draft of the channel on screen. */
  setDraft: (body: string) => void;
  restoreDraftFor: (channelId: string, body: string) => void;
  /** The tray's photos; only uploaded ones are scheduled (`refusal` holds the rest). */
  photos?: readonly { key: string; attachment: OutboxAttachment | null }[];
  /** The staged reply's message, or `null`. */
  replyToId?: string | null;
  /** Scheduled: take these photos out of the tray, and this reply off the strip. */
  onScheduled?: (scheduled: {
    channelId: string;
    photoKeys: string[];
    replyToId: string | null;
  }) => void;
}): {
  openSchedule: (() => void) | undefined;
  scheduled: { label: string; failed: number; onOpen: () => void } | null;
  sheets: ReactNode;
} {
  const scheduleRef = useRef<BottomSheetModal>(null);
  const listRef = useRef<BottomSheetModal>(null);
  const listChannel = showList ? channelId : null;
  const list = useScheduledMessages(listChannel);
  const create = useScheduleMessage();
  // What the open sheet schedules, why it can't, and when it opened, as they
  // stood on the long press.
  const [target, setTarget] = useState<{
    channelId: string;
    text: string;
    photoKeys: string[];
    attachments: OutboxAttachment[];
    replyToId: string | null;
    refusal: string | null;
    openedAt: Date;
  } | null>(null);
  // The draft and channel on screen when a schedule settles, which may not be
  // the ones it was opened on.
  const shownRef = useRef({ channelId, draft });
  useLayoutEffect(() => {
    shownRef.current = { channelId, draft };
  }, [channelId, draft]);

  const openSchedule = useCallback(() => {
    if (!channelId) return;
    Keyboard.dismiss();
    const uploaded = photos.filter((photo) => photo.attachment !== null);
    setTarget({
      channelId,
      text: draft.trim(),
      photoKeys: uploaded.map((photo) => photo.key),
      attachments: uploaded.map((photo) => photo.attachment!),
      replyToId,
      refusal,
      openedAt: new Date(),
    });
    scheduleRef.current?.present();
  }, [channelId, draft, photos, refusal, replyToId]);

  const openList = useCallback(() => {
    Keyboard.dismiss();
    listRef.current?.present();
  }, []);

  const schedule = useCallback(
    async (at: Date) => {
      if (!target) return;
      const shown = shownRef.current;
      const cleared =
        shown.channelId === target.channelId &&
        shown.draft.trim() === target.text;
      if (cleared) setDraft("");
      try {
        await create.mutateAsync({
          channelId: target.channelId,
          content: target.text,
          sendAt: at,
          mentionPicks: picksFor(target.text),
          attachments: target.attachments.map(attachmentRequestBody),
          replyToId: target.replyToId,
        });
      } catch (error) {
        if (cleared) {
          const now = shownRef.current;
          if (now.channelId !== target.channelId) {
            restoreDraftFor(target.channelId, target.text);
          } else if (!now.draft.trim()) {
            setDraft(target.text);
          }
        }
        throw error;
      }
      onScheduled?.({
        channelId: target.channelId,
        photoKeys: target.photoKeys,
        replyToId: target.replyToId,
      });
      AccessibilityInfo.announceForAccessibility(
        `Scheduled for ${formatScheduledFor(at, new Date())}`,
      );
    },
    [create, onScheduled, picksFor, restoreDraftFor, setDraft, target],
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

  const line = listChannel ? scheduledLine(list.data ?? [], new Date()) : null;

  const sheets = (
    <>
      <ScheduleSendSheet
        ref={scheduleRef}
        preview={target ? schedulePreview(target) : ""}
        refusal={target?.refusal ?? null}
        openedAt={target?.openedAt ?? null}
        onSchedule={schedule}
      />
      <ScheduledMessagesSheet ref={listRef} channelId={listChannel} />
    </>
  );

  return {
    openSchedule: canSchedule && channelId ? openSchedule : undefined,
    scheduled: line ? { ...line, onOpen: openList } : null,
    sheets,
  };
}

/** The sheet's line for what is being scheduled: the text, else its photos. */
function schedulePreview(target: { text: string; attachments: unknown[] }) {
  if (target.text) return target.text;
  const count = target.attachments.length;
  return count === 1 ? "1 photo" : count > 1 ? `${count} photos` : "";
}
