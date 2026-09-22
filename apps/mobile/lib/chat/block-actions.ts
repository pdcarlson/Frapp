import { useCallback } from "react";
import { Alert } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { statusOf, type createFrappClient } from "@repo/api-sdk";
import {
  CHAT_MESSAGE_QUERY_ROOT,
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";
import { useBlockMember, useFrappClient, useUnblockMember } from "@repo/hooks";
import { hasMaskedCopyFrom, replaceMaskedCopies } from "./blocks";

/**
 * Block and unblock for every mobile surface that offers them — the message
 * actions sheet, the tombstone, the directory's member sheet and Settings →
 * Blocked members — so the copy and the cache choreography exist once.
 *
 * `spec/behavior/chat/README.md` § Block owns what a block does. The strings
 * below say only what is true of this client today, and nothing about the
 * blocked member finding out: blocking is silent by contract. A block is
 * scoped to one chapter and a member can belong to several, so the copy says
 * "this chapter" wherever it says what a block hides.
 */

/** Used wherever the roster cannot name the member. */
export const UNNAMED_MEMBER = "this member";

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

export const UNBLOCK_CONFIRM_BODY =
  "Their messages in this chapter's chat will show again. They won't be told.";

export const BLOCK_FAILURE_BODY =
  "Nothing changed. Check your connection and try again.";

/** `POST /v1/chat/blocks` answers 404 (`Member not found`) for a non-member. */
export const BLOCK_NOT_A_MEMBER_BODY =
  "This member is no longer in your chapter, so there's nothing to block.";

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

type FrappClient = ReturnType<typeof createFrappClient>;

/** The channel id in a `chatMessagesKey`, or `null` for any other `["chat", …]` key. */
function channelIdOf(queryKey: readonly unknown[]): string | null {
  const [root, channelId, leaf] = queryKey;
  return root === CHAT_MESSAGE_QUERY_ROOT &&
    typeof channelId === "string" &&
    leaf === "messages" &&
    queryKey.length === 3
    ? channelId
    : null;
}

/**
 * After an unblock, bring the member's words back where the server had masked
 * them — best effort, out of band, and never by re-running a thread's query.
 *
 * Re-running the query (the old `invalidateQueries(["chat"])`) re-ran its
 * snapshot-then-await `queryFn`, which returns the cache as it was before its
 * reaction select: a Realtime row or a send that landed in that window was
 * overwritten, and a message could vanish for the session (#2257 review,
 * finding 3). Here each affected thread's newest page is fetched on its own
 * and folded into the cache **as it is when the response lands**, through
 * `replaceMaskedCopies`, which only swaps masked copies for their clear twins.
 *
 * Only threads that hold a masked copy from this member are read. Older copies
 * beyond the newest page stay masked until the thread is reloaded, and render
 * as stale tombstones. A failure changes nothing and is not reported: the
 * unblock itself succeeded, and the thread already shows the member's live
 * messages again because the client applies the list itself.
 *
 * A block needs no counterpart. The thread tombstones a blocked sender on every
 * path from the list alone, so there is nothing to re-read.
 */
export async function refreshMaskedCopies(
  queryClient: QueryClient,
  client: FrappClient,
  userId: string,
): Promise<void> {
  const channelIds = queryClient
    .getQueryCache()
    .findAll({ queryKey: [CHAT_MESSAGE_QUERY_ROOT] })
    .map((query) => channelIdOf(query.queryKey))
    .filter((channelId): channelId is string => channelId !== null)
    .filter((channelId) =>
      hasMaskedCopyFrom(
        queryClient.getQueryData<ChannelCache>(chatMessagesKey(channelId)),
        userId,
      ),
    );

  await Promise.all(
    channelIds.map(async (channelId) => {
      try {
        const result = await client.GET("/v1/channels/{id}/messages", {
          params: { path: { id: channelId }, query: { limit: 50 } },
        });
        if (!result.response.ok || !Array.isArray(result.data)) return;
        const rows = result.data as RawChatMessage[];
        queryClient.setQueryData<ChannelCache>(
          chatMessagesKey(channelId),
          (current) =>
            current ? replaceMaskedCopies(current, rows, userId) : current,
        );
      } catch {
        // Best effort — see above.
      }
    }),
  );
}

/**
 * The two block mutations, plus the one refresh `@repo/hooks` cannot do itself
 * (the chat caches' key lives in `@repo/chat-core`, which that leaf package
 * must not import): `refreshMaskedCopies` after an unblock.
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
  inDirectory,
  run,
  onDone,
}: ConfirmBlockOptions & {
  /** Whether the roster lists them — see {@link blockConfirmBody}. */
  inDirectory: boolean;
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
            Alert.alert(
              `Couldn't block ${label}`,
              statusOf(error) === 404
                ? BLOCK_NOT_A_MEMBER_BODY
                : BLOCK_FAILURE_BODY,
            );
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
