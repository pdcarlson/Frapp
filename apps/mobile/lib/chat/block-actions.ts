import { useCallback } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { CHAT_MESSAGE_QUERY_ROOT } from "@repo/chat-core/types";
import { useBlockMember, useUnblockMember } from "@repo/hooks";

/**
 * Block and unblock for every mobile surface that offers them — the message
 * actions sheet, the tombstone, the directory's member sheet and Settings →
 * Blocked members — so the copy and the cache choreography exist once.
 *
 * `spec/behavior/chat/README.md` § Block owns what a block does. The strings
 * below say only what is true of this client today, and nothing about the
 * blocked member finding out: blocking is silent by contract.
 */

/** Used wherever the roster cannot name the member. */
export const UNNAMED_MEMBER = "this member";

export const BLOCK_CONFIRM_BODY =
  "Their messages in chat will be hidden from you. They won't be told, " +
  "and they can still post where you both are. Poll votes still count, " +
  "and they stay in the directory. You can unblock them anytime in Settings.";

export const UNBLOCK_CONFIRM_BODY =
  "Their messages will show in chat again. They won't be told.";

export const BLOCK_FAILURE_BODY =
  "Nothing changed. Check your connection and try again.";

export function blockConfirmTitle(name: string): string {
  return `Block ${name}?`;
}

export function unblockConfirmTitle(name: string): string {
  return `Unblock ${name}?`;
}

export interface BlockActions {
  /** Resolves once the server confirmed and the caches were told. Rejects on failure. */
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  isPending: boolean;
}

/**
 * The two block mutations plus the one refresh `@repo/hooks` cannot do itself.
 *
 * The hooks fold the change into the block list and re-read it; this adds the
 * chat message caches, whose key lives in `@repo/chat-core`, which that leaf
 * package must not import. Every channel's cache, not only the open thread's:
 * a block covers the whole chapter. Re-reading makes the server re-mask the
 * newest page of each thread (a block) or serve it in the clear again (an
 * unblock) — the thread's list already hides a blocked sender on every path,
 * so this is what returns an unblocked member's words, which a masked row
 * never carried.
 */
export function useBlockActions(): BlockActions {
  const queryClient = useQueryClient();
  const { mutateAsync: blockAsync, isPending: blocking } = useBlockMember();
  const { mutateAsync: unblockAsync, isPending: unblocking } =
    useUnblockMember();

  const refreshThreads = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [CHAT_MESSAGE_QUERY_ROOT],
    });
  }, [queryClient]);

  const block = useCallback(
    async (userId: string) => {
      await blockAsync(userId);
      refreshThreads();
    },
    [blockAsync, refreshThreads],
  );

  const unblock = useCallback(
    async (userId: string) => {
      await unblockAsync(userId);
      refreshThreads();
    },
    [unblockAsync, refreshThreads],
  );

  return { block, unblock, isPending: blocking || unblocking };
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
  run,
  onDone,
}: ConfirmBlockOptions): void {
  const label = name ?? UNNAMED_MEMBER;
  Alert.alert(blockConfirmTitle(label), BLOCK_CONFIRM_BODY, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Block",
      style: "destructive",
      onPress: () => {
        void (async () => {
          try {
            await run();
            onDone?.();
          } catch {
            Alert.alert(`Couldn't block ${label}`, BLOCK_FAILURE_BODY);
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
            Alert.alert(`Couldn't unblock ${label}`, BLOCK_FAILURE_BODY);
          }
        })();
      },
    },
  ]);
}
