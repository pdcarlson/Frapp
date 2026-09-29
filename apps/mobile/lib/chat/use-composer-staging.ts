/**
 * What the s05 composer is doing besides an ordinary send: answering a
 * message (Reply) or rewriting one of the viewer's own (Edit), #2775.
 *
 * Kept out of `app/(tabs)/chat-thread.tsx` so it can be tested: everything
 * under `app/` ships as a route module, so a spec cannot sit beside the screen.
 *
 * **Both are keyed by channel.** `chat-thread` is a `Tabs.Screen` that stays
 * mounted while `channelId` changes in place, so a reply staged in #general
 * must not ride a send in #dues. A staged target belongs to the channel it was
 * staged in and resolves to nothing anywhere else, the same shape web's
 * `replyTo` takes.
 *
 * **What the strip shows is what the send carries.** The `replyToId` a send
 * reads comes from the same derivation as the strip the member can see, so the
 * two cannot disagree: a reply nobody was shown they were sending is ruled out
 * by construction.
 *
 * **A reply the send never took stays staged.** The strip clears as the send
 * goes out, as web's does, and comes back when `send` reports it did not
 * dispatch (an earlier send still in flight, or an outbox that refused the
 * row), so the words the member gets back are still a reply. A second tap on
 * the same staged reply, inside one render, is a duplicate of the send already
 * carrying it: it neither sends nor puts the reply back.
 *
 * **An edit never touches the draft.** The composer shows the message being
 * edited in place of the draft, and the draft, persisted per channel, is still
 * there when the edit is saved or cancelled. An edit closes when its message
 * is deleted under it (by an officer, or from another device), since the
 * server would refuse the save. It does not close merely because the message
 * isn't in the loaded window: a channel whose cache was collected while the
 * member was elsewhere starts empty, and the typed edit must survive the
 * reload. A save against a message that is really gone gets the server's
 * refusal in the hint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hiddenQuoteText, type BlockState } from "@repo/chat-core/blocks";
import {
  canActOnMessage,
  replyTargetId,
} from "@repo/chat-core/message-actions";
import {
  replyPreviewText,
  UNAVAILABLE_QUOTE,
} from "@repo/chat-core/reply-preview";
import type { ChatMessage } from "@repo/chat-core/types";
import { resolveAuthorLabel } from "@repo/hooks";
import type { ComposerContext } from "@/components/chat/chat-composer";
import type { SendOptions } from "./use-chat-channel";

/** The strip's title while an edit is open. */
export const EDITING_MESSAGE_TITLE = "Editing message";
/** The strip's title for a reply whose parent it cannot name. */
export const REPLYING_TO_A_MESSAGE = "Replying to a message";
/** The composer hint when an edit would leave the message empty. */
export const EDIT_EMPTY_HINT =
  "A message can't be empty. Delete it instead, or cancel the edit.";

interface StagedTarget {
  channelId: string;
  messageId: string;
}

interface EditState extends StagedTarget {
  value: string;
  /**
   * The message's text when the edit opened. The unchanged-save check and the
   * empty-edit hint compare against this, not the cached row, which a channel
   * reloading with an empty cache doesn't hold.
   */
  original: string;
}

export interface ComposerStagingInput {
  channelId: string | null;
  viewerId: string | null;
  /** Every cached message by id, held and tombstoned ones included. */
  byId: ReadonlyMap<string, ChatMessage>;
  nameFor: (userId: string) => string | null;
  blockState: BlockState;
  draft: string;
  setDraft: (body: string) => void;
  /** Resolves `true` once the message is queued, `false` when it was not. */
  send: (content: string, options?: SendOptions) => Promise<boolean>;
  edit: (messageId: string, content: string) => Promise<void>;
}

export interface ComposerStaging {
  /** The strip above the input, or `null` for an ordinary send. */
  context: ComposerContext | null;
  /** What the input shows: the text being edited, or the draft. */
  value: string;
  onChangeText: (next: string) => void;
  /** Sends the draft (as a reply when one is staged), or saves the edit. */
  submit: () => void;
  isEditing: boolean;
  isSavingEdit: boolean;
  /** Why the last save didn't land, or why this one can't. */
  editError: string | null;
  startReply: (messageId: string) => void;
  startEdit: (messageId: string) => void;
}

/** The reply strip for a staged parent: its author and one line of it. */
export function replyContextFor(
  parent: ChatMessage | null,
  viewerId: string | null,
  nameFor: (userId: string) => string | null,
  blockState: BlockState,
): Pick<ComposerContext, "title" | "preview"> {
  // Staged but not in the loaded window: the id is still sendable (the server
  // checks only that it names a message in this channel), so the strip stays
  // up, dismissable, rather than vanishing with the reply still attached.
  if (!parent || !viewerId) {
    return { title: REPLYING_TO_A_MESSAGE, preview: UNAVAILABLE_QUOTE };
  }
  // A parent the block list hides quotes as its placeholder alone, with no
  // author, exactly as the sent reply's quote will (#2312 §1).
  const hidden = hiddenQuoteText(parent, blockState, viewerId);
  if (hidden !== null) return { title: REPLYING_TO_A_MESSAGE, preview: hidden };
  return {
    title: `Replying to ${resolveAuthorLabel(parent, nameFor, viewerId)}`,
    preview: replyPreviewText(parent),
  };
}

export function useComposerStaging({
  channelId,
  viewerId,
  byId,
  nameFor,
  blockState,
  draft,
  setDraft,
  send,
  edit,
}: ComposerStagingInput): ComposerStaging {
  const [replyTarget, setReplyTarget] = useState<StagedTarget | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** Messages whose edit save is in flight, which `isSavingEdit` reports. */
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /**
   * The same, as a ref: the double-save guard. Two taps inside one render
   * both read the pre-commit state, so a state guard lets both through. Keyed
   * by message, so a save still out for #general never swallows one in #dues.
   */
  const savingRef = useRef(new Set<string>());
  /**
   * The staged reply a send is carrying right now. Two taps on Send inside
   * one render both see the same staged reply; the second is the duplicate
   * the channel hook's re-entry guard drops, and must neither send again nor
   * put back a reply the first tap already sent.
   */
  const replyInFlightRef = useRef<StagedTarget | null>(null);

  const activeReply =
    replyTarget && replyTarget.channelId === channelId ? replyTarget : null;

  const editTarget =
    editing && editing.channelId === channelId
      ? byId.get(editing.messageId)
      : undefined;
  // A message the window doesn't hold (yet) keeps its edit open; one that is
  // there and deleted closes it.
  const editGone = !!editTarget && !canActOnMessage(editTarget);
  const activeEdit =
    editing && editing.channelId === channelId && !editGone ? editing : null;
  // Closed during render rather than in an effect (React's "adjusting state
  // when a prop changes"), so no frame shows a strip for a deleted message.
  if (editing && editGone) {
    setEditing(null);
    setEditError(null);
  }

  /**
   * The edit open right now, for a save that resolves after the member moved
   * on. Mirrored in an effect because refs cannot be written during render.
   */
  const openEditRef = useRef<string | null>(null);
  const openEditId = activeEdit?.messageId ?? null;
  useEffect(() => {
    openEditRef.current = openEditId;
  }, [openEditId]);

  const cancelReply = useCallback(() => setReplyTarget(null), []);
  const cancelEdit = useCallback(() => {
    setEditing(null);
    setEditError(null);
  }, []);

  const context = useMemo<ComposerContext | null>(() => {
    if (activeEdit) {
      return {
        kind: "edit",
        title: EDITING_MESSAGE_TITLE,
        preview: null,
        onCancel: cancelEdit,
      };
    }
    if (activeReply) {
      const parent = byId.get(activeReply.messageId) ?? null;
      return {
        kind: "reply",
        ...replyContextFor(parent, viewerId, nameFor, blockState),
        onCancel: cancelReply,
      };
    }
    return null;
  }, [
    activeEdit,
    activeReply,
    blockState,
    byId,
    cancelEdit,
    cancelReply,
    nameFor,
    viewerId,
  ]);

  const startReply = useCallback(
    (messageId: string) => {
      const message = byId.get(messageId);
      if (!message) return;
      // One thing at a time in a channel: the strip has room for one, and a
      // send can't be both an edit and a reply. An edit left open in another
      // channel is that channel's, and stays.
      setEditing((current) =>
        current?.channelId === message.channel_id ? null : current,
      );
      setEditError(null);
      setReplyTarget({
        channelId: message.channel_id,
        messageId: replyTargetId(message),
      });
    },
    [byId],
  );

  const startEdit = useCallback(
    (messageId: string) => {
      const message = byId.get(messageId);
      if (!message) return;
      setReplyTarget((current) =>
        current?.channelId === message.channel_id ? null : current,
      );
      setEditError(null);
      setEditing({
        channelId: message.channel_id,
        messageId: message.id,
        value: message.content,
        original: message.content,
      });
    },
    [byId],
  );

  const onChangeText = useCallback(
    (next: string) => {
      if (activeEdit) {
        setEditing((current) =>
          current && current.messageId === activeEdit.messageId
            ? { ...current, value: next }
            : current,
        );
        return;
      }
      setDraft(next);
    },
    [activeEdit, setDraft],
  );

  const submit = useCallback(() => {
    if (activeEdit) {
      const { messageId } = activeEdit;
      if (savingRef.current.has(messageId)) return;
      const content = activeEdit.value.trim();
      // The composer already withholds Save on an empty edit, and the hint
      // below says why; this is the belt to that.
      if (!content) return;
      // Nothing changed: close without a request, so an unchanged save
      // doesn't stamp "edited" on a message nobody rewrote.
      if (content === activeEdit.original.trim()) {
        cancelEdit();
        return;
      }
      setEditError(null);
      savingRef.current.add(messageId);
      setSavingIds(new Set(savingRef.current));
      void edit(messageId, content)
        .then(() => {
          // Only the edit this save was for: the member may have cancelled it
          // and opened another while the request was out.
          setEditing((current) =>
            current?.messageId === messageId ? null : current,
          );
        })
        .catch((error: unknown) => {
          // The edit stays open with the member's text, so nothing is lost;
          // the hint says why it didn't save. Dropped if they moved on.
          if (openEditRef.current !== messageId) return;
          setEditError(
            error instanceof Error && error.message
              ? error.message
              : "Couldn't edit message. Try again.",
          );
        })
        .finally(() => {
          savingRef.current.delete(messageId);
          setSavingIds(new Set(savingRef.current));
        });
      return;
    }
    // Cleared before the send resolves, as web does: a strip still standing
    // after the reply appears in the thread reads as "your reply didn't send",
    // and would attach itself to whatever the member typed next. Put back if
    // the send didn't take it, unless the member has staged another since.
    const staged = activeReply;
    if (staged && replyInFlightRef.current === staged) return;
    if (staged) {
      replyInFlightRef.current = staged;
      setReplyTarget(null);
    }
    void send(draft, { replyToId: staged?.messageId ?? null }).then(
      (dispatched) => {
        if (!staged) return;
        if (replyInFlightRef.current === staged)
          replyInFlightRef.current = null;
        if (!dispatched) setReplyTarget((current) => current ?? staged);
      },
    );
  }, [activeEdit, activeReply, cancelEdit, draft, edit, send]);

  // An edit emptied of the text it had can't be saved, and the composer greys
  // Save out; this is what says why, rather than leaving a dead button. A
  // message that never had text (a photo sent with no caption) opens empty,
  // and an empty field there is just "no caption yet", not a mistake.
  const shownEditError = activeEdit
    ? (editError ??
      (!activeEdit.value.trim() && activeEdit.original.trim()
        ? EDIT_EMPTY_HINT
        : null))
    : null;

  return {
    context,
    value: activeEdit ? activeEdit.value : draft,
    onChangeText,
    submit,
    isEditing: !!activeEdit,
    // Keyed by the open edit's message: a save in flight for #general must
    // not lock the composer in #dues.
    isSavingEdit: !!activeEdit && savingIds.has(activeEdit.messageId),
    editError: shownEditError,
    startReply,
    startEdit,
  };
}
