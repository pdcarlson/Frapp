/**
 * What the s05 composer is doing besides an ordinary send: answering a
 * message (Reply) or rewriting one of the viewer's own (Edit), #2775.
 *
 * Kept out of `app/(app)/chat-thread.tsx` so it can be tested: everything
 * under `app/` ships as a route module, so a spec cannot sit beside the screen.
 *
 * **Both are kept per channel.** `chat-thread` is a `Tabs.Screen` that stays
 * mounted while `channelId` changes in place, so a reply staged in #general
 * must not ride a send in #dues, and an edit half-typed in #general must still
 * be there after a visit to #dues. Each channel holds at most one staged reply
 * or one open edit, and neither resolves anywhere else, the same shape web's
 * `replyTo` takes.
 *
 * **What the strip shows is what the send carries.** The `replyToId` a send
 * reads comes from the same derivation as the strip the member can see, so the
 * two cannot disagree: a reply nobody was shown they were sending is ruled out
 * by construction.
 *
 * **A reply the send never took stays staged.** The strip clears as the send
 * goes out, as web's does, and comes back when `send` reports it did not
 * dispatch (an outbox that refused the row), so the words the member gets
 * back are still a reply. A tap while an earlier send is still in flight
 * never takes the strip down, since `send` would refuse it. A second tap on
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

import { errorCopy } from "@repo/hooks/error-copy";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  hiddenQuoteText,
  withForwardedMasked,
  type BlockState,
} from "@repo/chat-core/blocks";
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
import {
  withMentionPick,
  mentionPicksIn,
  type MentionPick,
} from "@repo/validation";
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
  /** Why the last save of this edit didn't land, or `null`. */
  error: string | null;
}

function withoutKey<T>(
  map: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/** Applies `change` to a channel's open edit, if it is still that message's. */
function updateEdit(
  edits: Readonly<Record<string, EditState>>,
  channelId: string,
  messageId: string,
  change: (open: EditState) => EditState,
): Readonly<Record<string, EditState>> {
  const open = edits[channelId];
  if (!open || open.messageId !== messageId) return edits;
  return { ...edits, [channelId]: change(open) };
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
  /**
   * Whether a photo is staged, which makes an empty draft a message (an
   * attachment-only send is a real one).
   */
  hasAttachments: boolean;
  /**
   * Resolves `true` once the message is queued, `false` when it was not.
   * Online it settles only after the server has answered, so nothing that
   * belongs to the tap waits on it.
   */
  send: (content: string, options?: SendOptions) => Promise<boolean>;
  /**
   * Whether `send` would refuse a message now because an earlier one is still
   * in flight (`UseChatChannelResult.sendInFlight`), read on the tap.
   */
  sendInFlight: () => boolean;
  /** `mentionPicks`: the members picked into the edit (#3835). */
  edit: (
    messageId: string,
    content: string,
    mentionPicks?: readonly MentionPick[],
  ) => Promise<void>;
  /**
   * Runs on the tap, synchronously, once `submit` has decided a message goes
   * out and just before it hands that message to `send`: not for an edit, a
   * tap while an earlier send is still in flight (a second tap inside one
   * render included), or a draft with nothing in it. So the thread can follow
   * a send at once, rather than a network round-trip later and possibly in
   * another channel.
   */
  onSending?: () => void;
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
  /**
   * A member the `@` picker (or the message menu's Mention) wrote into the
   * text (#3835). The next send or save carries each one its text still
   * writes, so a picked name reaches that member or nobody.
   */
  addMentionPick: (pick: MentionPick) => void;
  /**
   * The picks `text` still writes, for a message sent another way than
   * `submit`: a scheduled one (#4956).
   */
  picksFor: (text: string) => MentionPick[];
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
    // A forward's copy the block list hides quotes as "Forwarded a message",
    // never its text, as the card draws it (#4864).
    preview: replyPreviewText(
      withForwardedMasked(parent, blockState, viewerId),
    ),
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
  hasAttachments,
  send,
  sendInFlight,
  edit,
  onSending,
}: ComposerStagingInput): ComposerStaging {
  // One staged reply and one open edit per channel, keyed by channel id: the
  // screen can be handed a new channel in place, and what a member left
  // staged or half-typed in #general is still there if they come back to it
  // before the thread is closed. Going back closes the thread (it is popped
  // off the stack), which drops both; the typed text itself is a draft and
  // outlives that (`draft-store.ts`).
  const [replies, setReplies] = useState<
    Readonly<Record<string, StagedTarget>>
  >({});
  const [edits, setEdits] = useState<Readonly<Record<string, EditState>>>({});
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
  // The members picked into this composer (#3835), newest first and one per
  // label: a re-pick of a label replaces the member it named. Shared by the
  // draft and an open edit, and never emptied by a send or a save: each
  // takes the picks its own text still writes (`mentionPicksIn`), so saving
  // an edit leaves the draft's picks, and a send or save that fails and is
  // tried again still carries them.
  const picksRef = useRef<MentionPick[]>([]);
  const addMentionPick = useCallback((pick: MentionPick) => {
    picksRef.current = withMentionPick(picksRef.current, pick);
  }, []);
  const picksFor = useCallback(
    (text: string) => mentionPicksIn(text, picksRef.current),
    [],
  );

  const activeReply = (channelId && replies[channelId]) || null;
  const editing = (channelId && edits[channelId]) || null;

  const editTarget = editing ? byId.get(editing.messageId) : undefined;
  // A message the window doesn't hold (yet) keeps its edit open; one that is
  // there and deleted closes it.
  const editGone = !!editTarget && !canActOnMessage(editTarget);
  const activeEdit = editing && !editGone ? editing : null;
  // Closed during render rather than in an effect (React's "adjusting state
  // when a prop changes"), so no frame shows a strip for a deleted message.
  if (editing && editGone) {
    setEdits((current) => withoutKey(current, editing.channelId));
  }

  const cancelReply = useCallback(() => {
    if (channelId) setReplies((current) => withoutKey(current, channelId));
  }, [channelId]);
  const cancelEdit = useCallback(() => {
    if (channelId) setEdits((current) => withoutKey(current, channelId));
  }, [channelId]);

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
      const channel = message.channel_id;
      // One thing at a time in a channel: the strip has room for one, and a
      // send can't be both an edit and a reply.
      setEdits((current) => withoutKey(current, channel));
      setReplies((current) => ({
        ...current,
        [channel]: { channelId: channel, messageId: replyTargetId(message) },
      }));
    },
    [byId],
  );

  const startEdit = useCallback(
    (messageId: string) => {
      const message = byId.get(messageId);
      if (!message) return;
      const channel = message.channel_id;
      setReplies((current) => withoutKey(current, channel));
      setEdits((current) => ({
        ...current,
        [channel]: {
          channelId: channel,
          messageId: message.id,
          value: message.content,
          original: message.content,
          error: null,
        },
      }));
    },
    [byId],
  );

  const onChangeText = useCallback(
    (next: string) => {
      if (activeEdit) {
        const { channelId: channel, messageId } = activeEdit;
        setEdits((current) =>
          updateEdit(current, channel, messageId, (open) => ({
            ...open,
            value: next,
          })),
        );
        return;
      }
      setDraft(next);
    },
    [activeEdit, setDraft],
  );

  const submit = useCallback(() => {
    if (activeEdit) {
      const { channelId: channel, messageId } = activeEdit;
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
      setEdits((current) =>
        updateEdit(current, channel, messageId, (open) => ({
          ...open,
          error: null,
        })),
      );
      savingRef.current.add(messageId);
      setSavingIds(new Set(savingRef.current));
      void edit(messageId, content, picksFor(content))
        .then(() => {
          // Only the edit this save was for: the member may have cancelled it
          // and opened another while the request was out.
          setEdits((current) =>
            current[channel]?.messageId === messageId
              ? withoutKey(current, channel)
              : current,
          );
        })
        .catch((error: unknown) => {
          // The edit stays open with the member's text, so nothing is lost;
          // its hint says why it didn't save. Dropped if they moved on.
          const reason = errorCopy(error, "Couldn't edit message. Try again.");
          setEdits((current) =>
            updateEdit(current, channel, messageId, (open) => ({
              ...open,
              error: reason,
            })),
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
    // Nothing to send: `send` would refuse it too, but deciding here is what
    // lets `onSending` run on the tap only for a message that goes out. The
    // composer already greys Send out on an empty draft; this is the belt.
    if (!channelId || (!draft.trim() && !hasAttachments)) return;
    // An earlier send still out (a slow POST): `send` refuses this one at its
    // re-entry guard, so jumping would move the reader for nothing. That guard
    // is claimed as `send` is called, so a second tap inside the same render
    // stops here too, and the jump runs once per message that goes out.
    if (sendInFlight()) return;
    if (staged) {
      replyInFlightRef.current = staged;
      setReplies((current) => withoutKey(current, staged.channelId));
    }
    onSending?.();
    void send(draft, {
      replyToId: staged?.messageId ?? null,
      mentionPicks: picksFor(draft),
    }).then((dispatched) => {
      if (!staged) return;
      if (replyInFlightRef.current === staged) replyInFlightRef.current = null;
      if (!dispatched) {
        setReplies((current) =>
          current[staged.channelId]
            ? current
            : { ...current, [staged.channelId]: staged },
        );
      }
    });
  }, [
    activeEdit,
    activeReply,
    cancelEdit,
    channelId,
    draft,
    edit,
    hasAttachments,
    onSending,
    send,
    sendInFlight,
    picksFor,
  ]);

  // An edit emptied of the text it had can't be saved, and the composer greys
  // Save out; this is what says why, rather than leaving a dead button. A
  // message that never had text (a photo sent with no caption) opens empty,
  // and an empty field there is just "no caption yet", not a mistake.
  const shownEditError = activeEdit
    ? (activeEdit.error ??
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
    addMentionPick,
    picksFor,
  };
}
