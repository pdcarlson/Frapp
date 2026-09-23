import { useCallback } from "react";
import { Alert } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  serverMessageOf,
  statusOf,
  type createFrappClient,
} from "@repo/api-sdk";
import {
  CHAT_MESSAGE_QUERY_ROOT,
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";
import { useBlockMember, useFrappClient, useUnblockMember } from "@repo/hooks";
import { hasMaskedCopyFrom, replaceMaskedCopies } from "./blocks";
import { maskedRefresh } from "./masked-refresh";

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

/**
 * The second line under a Block / Unblock row, on every surface that draws one
 * (the message actions sheet and the directory's member sheet), so the two
 * cannot explain one control two ways.
 */
export const BLOCK_ROW_DESCRIPTION =
  "Hides their messages from you in this chapter's chat. They aren't told.";
export const UNBLOCK_ROW_DESCRIPTION =
  "Their messages in this chapter's chat show again.";

/** A stale tombstone's Reload, when the re-read it re-runs fails again. */
export const MASKED_RELOAD_FAILED_TITLE = "Couldn't reload these messages";
export const MASKED_RELOAD_FAILED_BODY = "Check your connection and try again.";

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

export function unblockConfirmTitle(name: string): string {
  return `Unblock ${name}?`;
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

/** Waits between attempts of one thread's re-read: two retries, then give up. */
export const MASKED_REFRESH_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After an unblock, bring the member's words back where the server had masked
 * them — out of band, and never by re-running a thread's query.
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
 * beyond the newest page stay masked, as stale tombstones, until the thread's
 * query is next read from scratch — the thread screen stays mounted, so that is
 * a chapter switch, a sign-out, an app restart, or the default `gcTime` after
 * the member opens a different channel — and that read covers only the newest
 * page, so they then leave the timeline (spec/behavior/chat/README.md, Channel
 * messages row).
 *
 * **A failure is retried, then recorded — never swallowed.** Each thread's read
 * is tried up to `1 + retryDelaysMs.length` times, and a thread that no longer
 * holds a masked copy by the next attempt (reloaded, or another re-read landed)
 * counts as done. If one still fails, `masked-refresh.ts` records it and the
 * stale tombstones for that member offer Reload, which runs this again: after
 * a confirmed unblock the tombstone has no Unblock to offer, and without that
 * record the copies would be stranded with no control at all. The unblock
 * itself is unaffected either way — it succeeded, and the thread already shows
 * the member's live messages because the client applies the list itself.
 *
 * Resolves `true` when every affected thread was read. Never rejects.
 *
 * A block needs no counterpart. The thread tombstones a blocked sender on every
 * path from the list alone, so there is nothing to re-read.
 */
export async function refreshMaskedCopies(
  queryClient: QueryClient,
  client: FrappClient,
  userId: string,
  retryDelaysMs: readonly number[] = MASKED_REFRESH_RETRY_DELAYS_MS,
): Promise<boolean> {
  const holdsMaskedCopy = (channelId: string) =>
    hasMaskedCopyFrom(
      queryClient.getQueryData<ChannelCache>(chatMessagesKey(channelId)),
      userId,
    );

  const channelIds = queryClient
    .getQueryCache()
    .findAll({ queryKey: [CHAT_MESSAGE_QUERY_ROOT] })
    .map((query) => channelIdOf(query.queryKey))
    .filter((channelId): channelId is string => channelId !== null)
    .filter(holdsMaskedCopy);

  if (channelIds.length === 0) {
    maskedRefresh.set(userId, null);
    return true;
  }
  maskedRefresh.set(userId, "refreshing");

  /** One read of a thread's newest page, folded in. `false` on any failure. */
  async function readNewestPage(channelId: string): Promise<boolean> {
    try {
      const result = await client.GET("/v1/channels/{id}/messages", {
        params: { path: { id: channelId }, query: { limit: 50 } },
      });
      if (!result.response.ok || !Array.isArray(result.data)) return false;
      const rows = result.data as RawChatMessage[];
      queryClient.setQueryData<ChannelCache>(
        chatMessagesKey(channelId),
        (current) =>
          current ? replaceMaskedCopies(current, rows, userId) : current,
      );
      return true;
    } catch {
      return false;
    }
  }

  const results = await Promise.all(
    channelIds.map(async (channelId) => {
      for (let attempt = 0; ; attempt += 1) {
        if (await readNewestPage(channelId)) return true;
        const delay = retryDelaysMs[attempt];
        if (delay === undefined) return false;
        await wait(delay);
        if (!holdsMaskedCopy(channelId)) return true;
      }
    }),
  );

  const landed = results.every(Boolean);
  maskedRefresh.set(userId, landed ? null : "failed");
  return landed;
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
            Alert.alert(`Couldn't unblock ${label}`, BLOCK_FAILURE_BODY);
          }
        })();
      },
    },
  ]);
}
