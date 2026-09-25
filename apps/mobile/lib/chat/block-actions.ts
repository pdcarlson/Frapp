import { useCallback } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  BLOCK_FAILURE_BODY,
  UNBLOCK_CONFIRM_BODY,
  UNNAMED_MEMBER,
  unblockConfirmTitle,
  unblockFailedTitle,
} from "@repo/chat-core/block-copy";
import { refreshMaskedCopies } from "@repo/chat-core/blocks";
import { useBlockMember, useFrappClient, useUnblockMember } from "@repo/hooks";

/**
 * Block and unblock for every mobile surface that offers them — the message
 * actions sheet, the tombstone, the directory's member sheet and Settings →
 * Blocked members — so the copy and the cache choreography exist once.
 *
 * `spec/behavior/chat/README.md` § Block owns what a block does. The strings
 * below say only what is true of this client today, and nothing about the
 * blocked member finding out: blocking is silent by contract. A block is
 * scoped to one chapter and a member can belong to several, so the copy says
 * "this chapter" wherever it says what a block hides. Copy web says too (the
 * unblock confirmation, a failure) lives in `@repo/chat-core/block-copy`; what
 * is here names Block, which only mobile offers.
 */

/**
 * The block confirmation's body.
 *
 * `inDirectory` is whether the roster lists them. Only then is "they stay in
 * the directory" a true statement: a sender the roster has not loaded, or no
 * longer lists, may not be in it at all.
 */
export function blockConfirmBody(inDirectory: boolean): string {
  return (
    "Their messages in this chapter's chat will be hidden from you. " +
    "They won't be told, and they can still post where you both are. " +
    (inDirectory
      ? "Poll votes still count, and they stay in the directory. "
      : "Poll votes still count. ") +
    "You can unblock them anytime in Settings."
  );
}

/** `POST /v1/chat/blocks` answers 404 (`Member not found`) for a non-member. */
export const BLOCK_NOT_A_MEMBER_BODY =
  "This member is no longer in your chapter, so there's nothing to block.";

/**
 * The second line under a Block / Unblock row, on every surface that draws one
 * (the message actions sheet and the directory's member sheet), so the two
 * cannot explain one control two ways.
 */
export const BLOCK_ROW_DESCRIPTION =
  "Hides their messages from you in this chapter's chat. They aren't told.";
export const UNBLOCK_ROW_DESCRIPTION =
  "Their messages in this chapter's chat show again.";

/**
 * Whether a failed block is the API's "not a member of this chapter" answer:
 * a 404 whose message is `Member not found` (`ChatBlockService.block`). Any
 * other 404 — a route this build expects but the server does not serve, say —
 * is an ordinary failure, not evidence the member left.
 */
export function isMemberNotFound(error: unknown): boolean {
  return (
    statusOf(error) === 404 && serverMessageOf(error) === "Member not found"
  );
}

export function blockConfirmTitle(name: string): string {
  return `Block ${name}?`;
}

export interface BlockActions {
  /** Resolves once the server confirmed and the caches were told. Rejects on failure. */
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  /**
   * Re-runs the post-unblock re-read for one member — a stale tombstone's
   * Reload. Resolves `true` once every thread holding a masked copy of theirs
   * was read, `false` if any still could not be. Never rejects.
   */
  reloadMaskedCopies: (userId: string) => Promise<boolean>;
  isPending: boolean;
}

/**
 * The two block mutations, plus the one refresh `@repo/hooks` cannot do itself
 * (the chat caches' key lives in `@repo/chat-core`, which that leaf package
 * must not import): `refreshMaskedCopies` after an unblock, and again on a
 * stale tombstone's Reload.
 */
export function useBlockActions(): BlockActions {
  const queryClient = useQueryClient();
  const client = useFrappClient();
  const { mutateAsync: blockAsync, isPending: blocking } = useBlockMember();
  const { mutateAsync: unblockAsync, isPending: unblocking } =
    useUnblockMember();

  const block = useCallback(
    async (userId: string) => {
      await blockAsync(userId);
    },
    [blockAsync],
  );

  const unblock = useCallback(
    async (userId: string) => {
      await unblockAsync(userId);
      void refreshMaskedCopies(queryClient, client, userId);
    },
    [client, queryClient, unblockAsync],
  );

  const reloadMaskedCopies = useCallback(
    (userId: string) => refreshMaskedCopies(queryClient, client, userId),
    [client, queryClient],
  );

  return {
    block,
    unblock,
    reloadMaskedCopies,
    isPending: blocking || unblocking,
  };
}

export interface ConfirmBlockOptions {
  /** Display name, or `null` when the roster cannot resolve one. */
  name: string | null;
  /** Performs the write — `useBlockActions().block` bound to the target. */
  run: () => Promise<void>;
  /** After the server confirmed. Runs even if the calling sheet has closed. */
  onDone?: () => void;
}

/**
 * The block confirmation. A native alert rather than a sheet pane so every
 * surface asks the same question the same way — the directory sheet and the
 * message sheet cannot drift into two explanations of one control.
 *
 * `run` is awaited inside the alert's handler rather than fired through a
 * mutation's per-call `onSuccess`, which TanStack skips once the observing
 * component unmounts (see `lib/account/delete-account-prompt.ts`) — a sheet
 * dismissed mid-request must still report a failure.
 */
export function confirmBlockMember({
  name,
  inDirectory,
  run,
  onDone,
  onNotAMember,
}: ConfirmBlockOptions & {
  /** Whether the roster lists them — see {@link blockConfirmBody}. */
  inDirectory: boolean;
  /**
   * The API said they are not a member of this chapter
   * ({@link isMemberNotFound}) — the one positive evidence a member left, which
   * a caller can remember so it stops offering Block for them.
   */
  onNotAMember?: () => void;
}): void {
  const label = name ?? UNNAMED_MEMBER;
  Alert.alert(blockConfirmTitle(label), blockConfirmBody(inDirectory), [
    { text: "Cancel", style: "cancel" },
    {
      text: "Block",
      style: "destructive",
      onPress: () => {
        void (async () => {
          try {
            await run();
            onDone?.();
          } catch (error) {
            const notAMember = isMemberNotFound(error);
            Alert.alert(
              `Couldn't block ${label}`,
              notAMember ? BLOCK_NOT_A_MEMBER_BODY : BLOCK_FAILURE_BODY,
            );
            if (notAMember) onNotAMember?.();
          }
        })();
      },
    },
  ]);
}

/**
 * The unblock confirmation. Asked rather than applied on tap: unblocking puts
 * an abusive member's words back on screen, and a tombstone's Unblock sits in a
 * scrolling list where a stray tap is easy.
 */
export function confirmUnblockMember({
  name,
  run,
  onDone,
}: ConfirmBlockOptions): void {
  const label = name ?? UNNAMED_MEMBER;
  Alert.alert(unblockConfirmTitle(label), UNBLOCK_CONFIRM_BODY, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Unblock",
      onPress: () => {
        void (async () => {
          try {
            await run();
            onDone?.();
          } catch {
            Alert.alert(unblockFailedTitle(label), BLOCK_FAILURE_BODY);
          }
        })();
      },
    },
  ]);
}
