import { useCallback } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  BLOCK_FAILURE_BODY,
  BLOCK_NOT_A_MEMBER_BODY,
  UNBLOCK_CONFIRM_BODY,
  UNNAMED_MEMBER,
  blockConfirmBody,
  blockConfirmTitle,
  blockFailedTitle,
  isMemberNotFound,
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
 * "this chapter" wherever it says what a block hides. The confirmations and
 * failures are web's too and live in `@repo/chat-core/block-copy` (#2687);
 * what is here is the native alert flow.
 */

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
  /** Whether the roster lists them — see `blockConfirmBody`. */
  inDirectory: boolean;
  /**
   * The API said they are not a member of this chapter
   * (`isMemberNotFound`) — the one positive evidence a member left, which
   * a caller can remember so it stops offering Block for them.
   */
  onNotAMember?: () => void;
}): void {
  const label = name ?? UNNAMED_MEMBER;
  Alert.alert(
    blockConfirmTitle(label),
    blockConfirmBody(inDirectory, "in Settings"),
    [
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
                blockFailedTitle(label),
                notAMember ? BLOCK_NOT_A_MEMBER_BODY : BLOCK_FAILURE_BODY,
              );
              if (notAMember) onNotAMember?.();
            }
          })();
        },
      },
    ],
  );
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
