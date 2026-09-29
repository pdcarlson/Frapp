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
 * **An edit never touches the draft.** The composer shows the message being
 * edited in place of the draft, and the draft, persisted per channel, is still
 * there when the edit is saved or cancelled. An edit whose message is gone
 * from the loaded window, or was deleted under it (by an officer, or from
 * another device), closes, since the server would refuse the save.
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
  send: (content: string, options?: SendOptions) => Promise<void>;
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
  const [savingFor, setSavingFor] = useState<string | null>(null);

  const activeReply =
    replyTarget && replyTarget.channelId === channelId ? replyTarget : null;

  const editTarget =
    editing && editing.channelId === channelId
      ? byId.get(editing.messageId)
      : undefined;
  const activeEdit =
    editing && editTarget && canActOnMessage(editTarget) ? editing : null;
  // The message left the window or was deleted under the open edit. Closed
  // during render rather than in an effect (React's "adjusting state when a
  // prop changes"), so no frame shows a strip for a message that is gone.
  if (editing && editing.channelId === channelId && !activeEdit) {
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
      // One thing at a time: the strip has room for one, and a send can't be
      // both an edit and a reply.
      setEditing(null);
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
      if (savingFor !== null) return;
      const messageId = activeEdit.messageId;
      const content = activeEdit.value.trim();
      if (!content) {
        setEditError(EDIT_EMPTY_HINT);
        return;
      }
      // Nothing changed: close without a request, so an unchanged save
      // doesn't stamp "edited" on a message nobody rewrote.
      if (content === editTarget?.content.trim()) {
        cancelEdit();
        return;
      }
      setEditError(null);
      setSavingFor(messageId);
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
        .finally(() => setSavingFor(null));
      return;
    }
    // Cleared before the send resolves, as web does: a strip still standing
    // after the reply appears in the thread reads as "your reply didn't send",
    // and would attach itself to whatever the member typed next.
    const replyToId = activeReply?.messageId ?? null;
    if (activeReply) setReplyTarget(null);
    void send(draft, { replyToId });
  }, [
    activeEdit,
    activeReply,
    cancelEdit,
    draft,
    edit,
    editTarget,
    savingFor,
    send,
  ]);

  return {
    context,
    value: activeEdit ? activeEdit.value : draft,
    onChangeText,
    submit,
    isEditing: !!activeEdit,
    isSavingEdit: savingFor !== null,
    editError: activeEdit ? editError : null,
    startReply,
    startEdit,
  };
}
