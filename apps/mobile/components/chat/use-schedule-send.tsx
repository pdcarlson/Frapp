import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Alert, Keyboard } from "react-native";
import { errorCopy } from "@repo/hooks/error-copy";
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
/** The alert when a refused schedule can't go back into any composer (#5005). */
export const SCHEDULE_NOT_SENT_TITLE = "Your message wasn't scheduled";

export function useScheduleSend({
  channelId,
  threadRootId = null,
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
  /**
   * The thread a reply is scheduled into (#5005), or `null` for the channel.
   * In a thread the line and the list are that thread's alone.
   */
  threadRootId?: string | null;
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
  /**
   * Puts a refused draft back into a channel no longer on screen. Absent in
   * a thread, which keeps no draft once it is left: there an alert says it
   * wasn't scheduled and carries the words.
   */
  restoreDraftFor?: (channelId: string, body: string) => void;
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
  const list = useScheduledMessages(listChannel, threadRootId);
  const create = useScheduleMessage();
  // What the open sheet schedules, why it can't, and when it opened, as they
  // stood on the long press.
  const [target, setTarget] = useState<{
    channelId: string;
    threadRootId: string | null;
    text: string;
    photoKeys: string[];
    attachments: OutboxAttachment[];
    replyToId: string | null;
    refusal: string | null;
    openedAt: Date;
  } | null>(null);
  // The draft and channel on screen when a schedule settles, which may not be
  // the ones it was opened on.
  const shownRef = useRef({ channelId, threadRootId, draft });
  // Whether the screen is still there when a schedule settles.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    shownRef.current = { channelId, threadRootId, draft };
  }, [channelId, threadRootId, draft]);

  const openSchedule = useCallback(() => {
    if (!channelId) return;
    Keyboard.dismiss();
    const uploaded = photos.filter((photo) => photo.attachment !== null);
    setTarget({
      channelId,
      threadRootId,
      text: draft.trim(),
      photoKeys: uploaded.map((photo) => photo.key),
      attachments: uploaded.map((photo) => photo.attachment!),
      replyToId,
      refusal,
      openedAt: new Date(),
    });
    scheduleRef.current?.present();
  }, [channelId, threadRootId, draft, photos, refusal, replyToId]);

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
        shown.threadRootId === target.threadRootId &&
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
          threadRootId: target.threadRootId,
        });
      } catch (error) {
        if (cleared) {
          const now = shownRef.current;
          const moved =
            now.channelId !== target.channelId ||
            now.threadRootId !== target.threadRootId;
          if (!restoreDraftFor && (moved || !mountedRef.current)) {
            // A thread keeps no draft once it is left, and its sheet was
            // dismissed with it: an alert outlives the screen, so the
            // member learns it didn't go and has the words to send again.
            Alert.alert(
              SCHEDULE_NOT_SENT_TITLE,
              `${errorCopy(error)}\n\n${target.text}`,
            );
          } else if (moved) {
            restoreDraftFor?.(target.channelId, target.text);
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

  // Leaving the channel, or the thread, closes both, as the + sheet's forms
  // close.
  const place = channelId ? `${channelId}:${threadRootId ?? ""}` : null;
  useFocusEffect(
    useCallback(() => {
      if (!place) return;
      return () => {
        scheduleRef.current?.dismiss();
        listRef.current?.dismiss();
      };
    }, [place]),
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
      <ScheduledMessagesSheet
        ref={listRef}
        channelId={listChannel}
        threadRootId={threadRootId}
      />
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
