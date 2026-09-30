/**
 * Component-facing facade for a single chat channel on React Native.
 *
 * The mobile counterpart of `apps/web/lib/chat/use-chat-channel.ts`, and the
 * only thing s05 touches: it hides the normalized cache, the realtime manager,
 * the outbox, and the drafts behind arrays and callbacks.
 *
 * The two are not one hook, on purpose (#1004), and this header is where the
 * relationship is written down; the web hook's points here. What they share is
 * logic, and the logic lives in `@repo/chat-core`, which stays framework-free:
 * the history pager and page fetcher, `olderHistoryView`, the realtime manager
 * (the typing list's identity, and following the viewer: attaching a channel
 * subscribed before `configure`, tracking a viewer who resolves after the
 * join, rejoining on a switch), and the chat-client actions. Each hook holds
 * only its client's React wiring around those, so a fix to shared behaviour
 * belongs in chat-core, where both clients get it. What differs, and why:
 *
 * 1. **`ctx` comes from `useChatRuntime()`**, not from a provider. `app/_layout.tsx`
 *    is a frozen hotspot file, so the runtime is a hook the chat screens call
 *    (`spec/ui/mobile/patterns.md` § Chat). That also means `ctx` is `null` until
 *    the viewer's `users.id` resolves, so every callback here guards on it. Web
 *    builds its `ctx` in the hook, on the cached viewer id (#2249).
 * 2. **No `toast`.** `ChatActionContext.toast` is optional and mobile supplies
 *    none, so chat-core's failure toasts are silent no-ops. A terminal 4xx on
 *    `send` surfaces as `_status: "failed"` + `_error` in the cache, which the
 *    thread renders inline. An outbox that refused the row rejects `send`'s
 *    `sendMessage`, and `send` catches that into `sendError`. The rest reports
 *    through `ChatActionContext.onError`, the platform-neutral sink `chat-core`
 *    fires alongside (never instead of) `toast`, wired per call: into
 *    `reactionError` (#999) and `actionError`, which the screen draws, and into
 *    the message `edit` and `remove` reject with.
 * 3. **No outbox `get`.** That is a web-only extra on the Dexie store; the
 *    port itself only offers `listForChannel`, so retry/discard look the row up
 *    through it.
 * 4. **No slash dispatch.** `@repo/chat-core/dispatch` pulls in
 *    `@repo/chat-integrations`, whose `types`/`require` conditions point at an
 *    unbuilt `dist/` (#989), and slash commands are not a mobile surface.
 *    `unconfirmed`/`recorded` rows therefore have no replay path; the thread
 *    presents them read-only (#1910) until one exists. Do not invent a slash
 *    dispatch from here. Web's `dispatchSlash`, `retryUnconfirmed` and the
 *    persisted-notice merge in its channel query all hang off it.
 * 5. **The draft and the staged attachments live here.** Web's draft has its
 *    own hook (`useChannelDraft`, #2176) and its composer owns the attachments
 *    it passes to `send`. Here `send` claims whatever is staged, and both reset
 *    on a channel switch.
 * 6. **The realtime attach waits on `bootChatAdapters()`** and on the viewer;
 *    the comment on that effect has the ordering it protects.
 * 7. **Surface-only members.** Mobile has `reload`, `canSend` and `viewerId`
 *    for s05; web has `loadNewer` for jump-to-message and keeps the channel's
 *    tail on disk for its first paint.
 *
 * Imports stay subpath-only for the same reason the runtime's do.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actOnCard,
  deleteMessage,
  discardOutboxRow,
  editMessage,
  flushOutbox,
  hydrateOutboxIntoCache,
  react as reactAction,
  retryOutboxRow,
  sendMessage,
  unreact as unreactAction,
  type CardActionArgs,
  type ChatErrorFn,
} from "@repo/chat-core/chat-client";
import { emptyCache, selectMessages } from "@repo/chat-core/cache";
import {
  createHistoryPageFetcher,
  createHistoryPager,
  olderHistoryView,
  type LoadOlderResult,
} from "@repo/chat-core/history";
import {
  chatRealtime,
  NO_TYPING_USERS,
  type ConnectionStatus,
} from "@repo/chat-core/realtime-manager";
import {
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
} from "@repo/chat-core/types";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import { useFrappClient } from "@repo/hooks";
import { moduleRefusalFromServerMessage } from "@repo/validation";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";

import { getSupabaseClient } from "@/lib/supabase";
import { bootChatAdapters, useChatRuntime } from "./use-chat-runtime";

/** Matches web's debounce so a draft write never rides every keystroke. */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

export interface SendOptions {
  /**
   * The message this one replies to, already root-normalized
   * (`replyTargetId` in `@repo/chat-core/message-actions`).
   */
  replyToId?: string | null;
}

/**
 * Runs a chat-core edit or delete and turns its failure into an `Error`
 * carrying the member-facing description chat-core classified, since mobile
 * has no toast to show it (#999).
 */
async function withFailureMessage(
  run: (onError: ChatErrorFn) => Promise<void>,
  fallback: string,
): Promise<void> {
  let described: string | null = null;
  try {
    await run((input) => {
      described = input.description ?? input.title;
    });
  } catch {
    throw new Error(described ?? fallback);
  }
}

export interface UseChatChannelResult {
  messages: ChatMessage[];
  isLoading: boolean;
  loadError: Error | null;
  /** Reads the newest page again, for the thread's failed-load Retry. */
  reload: () => void;
  /** A read of the newest page is in flight (the first, or a `reload`). */
  isReloading: boolean;
  /**
   * Whether older history may exist beyond the loaded rows (#2772). True
   * until a read comes back short, so a channel the member has not scrolled to
   * the top of says "maybe" rather than "no".
   */
  hasOlder: boolean;
  isLoadingOlder: boolean;
  /** The last older-page read failed; cleared by the next attempt. */
  olderError: boolean;
  /**
   * Loads the next page of older history. Concurrent calls share one read.
   * Resolves what it did (`LoadOlderResult`, `@repo/chat-core/history`).
   */
  loadOlder: () => Promise<LoadOlderResult>;
  /** `null` until the viewer's app user resolves; own-message styling keys off it. */
  viewerId: string | null;
  /** False while `ctx` is null — the composer must disable rather than no-op silently. */
  canSend: boolean;
  /**
   * Sends the body *and* whatever `attachments` currently holds — the staged
   * list is owned here, not passed in, for the same reason `draft` is: it has
   * to survive a failed send and reset on a channel switch, and both of those
   * are this hook's existing jobs. A photo staged in #general riding the next
   * message in #dues is the bug that shape prevents.
   *
   * Resolves `true` once the message is in the outbox, `false` when nothing
   * was queued (an empty body, an earlier send still in flight, no runtime, or an
   * outbox that refused the row), so a caller holding state for this send (a
   * staged reply) can keep it. Never rejects.
   */
  send: (content: string, options?: SendOptions) => Promise<boolean>;
  /**
   * Saves an edit of the viewer's own message. Not optimistic: the server row
   * is merged on success, and the Realtime echo of the same edit is a no-op.
   * Rejects with a member-facing message on failure, and changes nothing.
   */
  edit: (messageId: string, content: string) => Promise<void>;
  /**
   * Soft-deletes a message (own, or any with `channels:manage`). Pessimistic
   * like `edit`, per `spec/ui/resilience/`: the tombstone lands when the
   * server says so. Rejects with a member-facing message on failure.
   */
  remove: (messageId: string) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  unreact: (messageId: string, emoji: string) => Promise<void>;
  /** Inline-card action dispatch (poll votes, #528; RSVP/Done in a future card). */
  act: (
    messageId: string,
    actionType: string,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  /**
   * Uploaded-and-waiting attachments the next send will claim. The bytes are
   * already in the bucket (`lib/chat/attachment-upload.ts`), so dropping one
   * drops the claim, not the object.
   */
  attachments: OutboxAttachment[];
  addAttachment: (attachment: OutboxAttachment) => void;
  removeAttachment: (storagePath: string) => void;
  draft: string;
  setDraft: (body: string) => void;
  /**
   * Last send failure. `null` once a fresh `send` is attempted or the
   * member switches channels (#1431 — this used to outlive a channel
   * switch, unlike `reactionError`). Editing the draft or calling `retry`
   * does **not** clear it on its own — neither touches `sendError` — so a
   * failed-send composer hint persists until one of the two above.
   */
  sendError: string | null;
  /**
   * Last `react`/`unreact` rejection. `chat-core` already rolls the
   * optimistic toggle back on failure; this is only the explanation, since
   * mobile has no toast (#999). `null` once cleared by `clearReactionError`,
   * the next reaction attempt, or a channel change.
   */
  reactionError: string | null;
  /** Dismisses `reactionError` — call on the next successful action or navigation away. */
  clearReactionError: () => void;
  /**
   * Last `act` (inline-card action, e.g. a poll vote) rejection. Same reason
   * and same shape as `reactionError` — `actOnCard` fires the same
   * platform-neutral `onError` sink `react`/`unreact` do (#999) — kept as its
   * own state rather than merged into `reactionError` so a failed vote and a
   * failed reaction can't dismiss each other's message.
   */
  actionError: string | null;
  /** Dismisses `actionError` — call on the next successful action or navigation away. */
  clearActionError: () => void;
  /** The manager's list: the same array until someone starts or stops typing. */
  typingUsers: readonly string[];
  emitTyping: () => void;
  connection: ConnectionStatus;
  retry: (clientMessageId: string) => Promise<void>;
  discard: (clientMessageId: string) => Promise<void>;
}

export function useChatChannel(channelId: string | null): UseChatChannelResult {
  const { ctx, viewerId, outbox, drafts } = useChatRuntime();
  const apiClient = useFrappClient();
  const queryClient = useQueryClient();

  // Read the client directly rather than through `ctx`. `ctx` is null until the
  // viewer's `users.id` resolves, and the channel query runs on first render
  // with `staleTime: Infinity` and no `supabase` in its key — so sourcing it
  // from `ctx` meant the reaction hydration was skipped on every cold start and
  // never retried, leaving reactions blank and poll cards at zero until a live
  // action INSERT happened to arrive. Web is not exposed to this because its
  // client comes from a provider, not from `ctx`.
  const supabase = useMemo(() => getSupabaseClient(), []);
  // Every page, the newest and each older one, reads through the one chat-core
  // pager, which also keeps where each channel's history starts and each
  // channel's older-page status — per channel, because this screen stays
  // mounted across channel switches. Web's hook reads through the same one.
  const pager = useMemo(
    () =>
      createHistoryPager(
        queryClient,
        createHistoryPageFetcher(apiClient, supabase),
      ),
    [queryClient, apiClient, supabase],
  );
  const pagerState = useSyncExternalStore(pager.subscribe, pager.getSnapshot);

  // The newest page. Folded into this key as it stands when the read lands,
  // never started from `emptyCache()`: three other writers target the same key
  // while the fetch is in flight — an optimistic send, `hydrateOutboxIntoCache`,
  // and the realtime merge — and starting from empty discarded all of them (a
  // message sent during the initial spinner vanished, its outbox row already
  // dequeued). `readNewestPage` keeps those and drops only older confirmed rows
  // the page did not re-read, so a message the server deleted meanwhile does
  // not linger either.
  const query = useQuery<ChannelCache, Error>({
    queryKey: channelId ? chatMessagesKey(channelId) : ["chat", "none"],
    enabled: !!channelId,
    staleTime: Infinity,
    queryFn: () => (channelId ? pager.readNewest(channelId) : emptyCache()),
  });

  const { refetch } = query;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Older history (#2772), one page per call, merged into the same cache the
  // realtime merge, the outbox and the reconnect backfill write to. It only
  // adds rows older than the oldest confirmed one, so it cannot disturb a
  // queued send or a backfilled arrival.
  const loadOlder = useCallback(
    (): Promise<LoadOlderResult> =>
      channelId ? pager.loadOlder(channelId) : Promise.resolve("start"),
    [channelId, pager],
  );

  // Ref-counted realtime attach. `useChatRuntime` configures the manager but
  // deliberately does not subscribe — the screen owns its own pair, and the
  // manager refcounts so two screens on one channel cannot unsubscribe each
  // other. Backfill is not triggered here: the manager fires it on SUBSCRIBED.
  //
  // Subscribing is deferred behind `bootChatAdapters()` for a reason that is not
  // about the adapters: the runtime applies `configure({viewerId})` inside a
  // `.then` on that same promise, so a synchronous `subscribe()` here ran one
  // microtask *earlier* and `installChannel` captured `viewerId: null` from the
  // boot-time configure. A channel attached that way never calls `channel.track`,
  // so the viewer has no presence entry — and the push worker reads presence on
  // `chat:channel:<id>` to skip members currently in the channel (ADR-10), so
  // they would be pushed notifications for the thread they are reading. Since
  // #3002 the runtime's `configure({viewerId})` would also repair that, by
  // tracking the viewer on the joined channel; this ordering still has the
  // channel join under the viewer from the start. Both callbacks hang off one
  // already-resolved promise and run in registration order, and the runtime's
  // effect is declared first (it is called at the top of this hook), so its
  // `configure` is guaranteed to land before this `subscribe`.
  /*
    Keyed on `channelId` and `viewerId`, deliberately NOT on `ctx`.

    It used to carry `ctx`, which was harmless while every member of `ctx` was
    stable for the life of the mount — and stopped being so when `ctx.outbox`
    became scope-bound (#2228), because the scope resolves a few milliseconds
    after mount. Web hit this first and split the same effect for the same
    reason (#2226, `apps/web/lib/chat/use-chat-channel.ts`).

    Leaving it in tears the topic down and rebuilds it: at refCount 1→0
    `unsubscribe` calls `removeChannel` and drops the manager's channel state,
    so the re-subscribe mints a fresh `joining` — a websocket leave/rejoin, a
    second backfill, discarded typing state, and the connection pill flickering
    off `live`. The realtime topic has nothing to do with which member's outbox
    is mounted.

    `viewerId` stays, and is what the old `ctx` guard was really for: it is the
    presence half described above. It is a plain string that changes only when
    the viewer actually changes — which *should* re-attach — so it does not
    churn the way an object identity does.
  */
  useEffect(() => {
    if (!channelId || !viewerId) return;
    let cancelled = false;
    let attached = false;

    void bootChatAdapters().then(() => {
      if (cancelled) return;
      chatRealtime.subscribe(channelId);
      attached = true;
    });

    return () => {
      cancelled = true;
      // Only release a refcount this effect actually took, or an unmount that
      // races the boot would decrement someone else's subscription.
      if (attached) chatRealtime.unsubscribe(channelId);
    };
  }, [channelId, viewerId]);

  // The outbox hydrate genuinely does depend on the scope — it replays this
  // member's unsent rows — so it keeps `ctx` and runs on its own, exactly as
  // web split it. Re-running it on a scope change is correct and cheap:
  // `mergeServerRows`-style upserts only add, and the realtime topic above is
  // left alone.
  useEffect(() => {
    if (!channelId || !ctx) return;
    let cancelled = false;
    void bootChatAdapters().then(() => {
      if (cancelled) return;
      void hydrateOutboxIntoCache(ctx, channelId).catch(() => {
        // Best-effort, and explicitly caught. A rejected AsyncStorage read
        // would otherwise be an unhandled rejection carrying no channel
        // context. The timeline still paints; it just starts without the
        // unsent rows.
      });
    });
    return () => {
      cancelled = true;
    };
  }, [channelId, ctx]);

  const [connection, setConnection] = useState<ConnectionStatus>("live");
  useEffect(() => chatRealtime.subscribeStatus(setConnection), []);

  // The manager pings status listeners on typing-membership changes too, so one
  // subscription drives both the connection pill and the typing line. Most
  // pings carry no change for this channel, and `getTypingUsers` then hands
  // back the array it returned last, so this set bails out instead of
  // re-rendering the thread and rebuilding every visible row's StyleSheet. That
  // identity used to be compared here; it is the manager's job now, so web gets
  // it too (#1004).
  const [typingUsersState, setTypingUsers] =
    useState<readonly string[]>(NO_TYPING_USERS);
  useEffect(() => {
    if (!channelId) return;
    const refresh = () =>
      setTypingUsers(chatRealtime.getTypingUsers(channelId));
    refresh();
    return chatRealtime.subscribeStatus(refresh);
  }, [channelId]);
  const typingUsers = channelId ? typingUsersState : NO_TYPING_USERS;

  // Draft: load once per channel, debounce writes.
  const [draftState, setDraftState] = useState("");
  const [attachments, setAttachments] = useState<OutboxAttachment[]>([]);
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    void drafts.load(channelId).then((body) => {
      if (!cancelled) setDraftState(body);
    });
    return () => {
      cancelled = true;
    };
  }, [channelId, drafts]);
  const draft = channelId ? draftState : "";

  /** Set while a send is in flight; see the re-entry guard in `send`. */
  const sendingRef = useRef(false);
  /** Last send failure, surfaced by the composer since mobile has no toast. */
  const [sendError, setSendError] = useState<string | null>(null);
  /** Last react/unreact failure, surfaced the same way (#999). */
  const [reactionError, setReactionError] = useState<string | null>(null);
  const clearReactionError = useCallback(() => setReactionError(null), []);
  /** Last inline-card-action (e.g. poll vote, #528) failure — see the field doc. */
  const [actionError, setActionError] = useState<string | null>(null);
  const clearActionError = useCallback(() => setActionError(null), []);
  // A channel switch must not carry a previous channel's send, reaction, or
  // action failure onto this one — nothing here retries or discards it the
  // way a failed-send bubble can, so it would otherwise sit until the member
  // happened to trigger another one. Reset inline during render (React's
  // "adjusting state when a prop changes" pattern, https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // rather than in an effect, which would fire an extra render after the
  // channel-switch render already committed.
  //
  // One tracked channel id covers every per-channel error setter (#1431 —
  // `sendError` had no reset at all until this fix, unlike `reactionError`'s
  // #999 precedent) rather than a bespoke `<name>ErrorChannelId` copy per
  // error, so a future failure sink (e.g. an inline-card-action error) only
  // has to add itself to the list below, not reinvent the pattern.
  const [errorResetChannelId, setErrorResetChannelId] = useState(channelId);
  if (errorResetChannelId !== channelId) {
    setErrorResetChannelId(channelId);
    if (sendError !== null) setSendError(null);
    if (reactionError !== null) setReactionError(null);
    if (actionError !== null) setActionError(null);
    // Staged attachments are per-channel exactly as the draft is. Unlike the
    // draft they are NOT persisted and restored per channel: the bytes are in
    // the bucket but the claim is in memory, so switching away abandons it and
    // the retention pass collects the object. Carrying it across the switch
    // would be the worse failure — the photo would ride the next message in a
    // channel it was never meant for.
    if (attachments.length > 0) setAttachments([]);
  }
  /**
   * Always the current `channelId`, for the generation check below. Refs
   * cannot be read or written during render (`react-hooks/refs`), so this
   * mirrors `channelId` via an effect rather than joining the render-time
   * reset above.
   */
  const currentChannelIdRef = useRef(channelId);
  useEffect(() => {
    currentChannelIdRef.current = channelId;
  }, [channelId]);
  /**
   * Bumped once per `react`/`unreact` dispatch. `reactAction`/`unreactAction`
   * resolve asynchronously, so without a generation check a request that is
   * still in flight when the member switches channels — or fires a second
   * reaction before the first settles — reports its failure through a stale
   * closure: `setReactionError` would run against whatever channel or action
   * is on screen *by then*, not the one the request was actually for.
   */
  const reactionGenerationRef = useRef(0);
  const reactWithErrorSink = useCallback(
    (fn: typeof reactAction, args: Parameters<typeof reactAction>[1]) => {
      if (!ctx) return Promise.resolve();
      const forChannelId = channelId;
      const generation = ++reactionGenerationRef.current;
      setReactionError(null);
      return fn(
        {
          ...ctx,
          onError: (input) => {
            // Stale if the channel has moved on, or a later react/unreact on
            // this same channel has already superseded this one.
            if (
              currentChannelIdRef.current !== forChannelId ||
              reactionGenerationRef.current !== generation
            ) {
              return;
            }
            setReactionError(input.description ?? input.title);
          },
        },
        args,
      );
    },
    [ctx, channelId],
  );

  /**
   * Bumped once per `act` dispatch (e.g. a poll vote, #528) — same
   * stale-closure guard as `reactionGenerationRef`, kept as its own ref so a
   * card action in flight and a reaction in flight don't supersede each
   * other's generation check.
   */
  const actionGenerationRef = useRef(0);
  const actWithErrorSink = useCallback(
    (args: CardActionArgs) => {
      if (!ctx) return Promise.resolve();
      const forChannelId = channelId;
      const generation = ++actionGenerationRef.current;
      setActionError(null);
      return actOnCard(
        {
          ...ctx,
          onError: (input) => {
            if (
              currentChannelIdRef.current !== forChannelId ||
              actionGenerationRef.current !== generation
            ) {
              return;
            }
            // A vote on a poll card is refused while Polls is off (#2993),
            // with the guard's sentence to an officer. A member can't act on
            // it, so they get their own row (`writing.md` § Module off).
            // `actOnCard` passes the server's message through as-is.
            const refusal = moduleRefusalFromServerMessage(input.description);
            setActionError(
              refusal?.moduleKey === "polls"
                ? MODULE_REFUSAL_COPY.polls
                : (input.description ?? input.title),
            );
          },
        },
        args,
      );
    },
    [ctx, channelId],
  );

  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDraftTimer = useCallback(() => {
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
  }, []);
  // A pending write must not outlive the screen, or it lands after the clear.
  useEffect(() => cancelDraftTimer, [cancelDraftTimer]);

  const setDraft = useCallback(
    (body: string) => {
      setDraftState(body);
      if (!channelId) return;
      cancelDraftTimer();
      draftTimer.current = setTimeout(() => {
        void drafts.save(channelId, body);
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [channelId, cancelDraftTimer, drafts],
  );

  /**
   * Bumped once per `send` dispatch, mirroring `reactionGenerationRef`.
   * `sendMessage` resolves asynchronously, so without this the catch below
   * repaints a *stale* channel's failure (and restores its failed draft
   * text) onto whichever channel is on screen once it finally rejects — the
   * exact race `errorResetChannelId`'s reset above cannot catch by itself,
   * since the reset only clears an error already set, not one still to
   * arrive (#1431).
   */
  const sendGenerationRef = useRef(0);
  const send = useCallback(
    async (content: string, options?: SendOptions) => {
      const body = content.trim();
      // Snapshotted before the await, and cleared by identity afterwards: a
      // photo that finishes uploading while this send is in flight must not be
      // cleared as though it had been claimed.
      const staged = attachments;
      // `sendingRef`, not state: this guards re-entry within a single tick, and
      // a state flag would not be visible to a second tap landing before the
      // re-render. Without it, a send held open by a slow POST leaves the
      // composer full and the button live, and a second tap generates a *fresh*
      // `client_message_id` — which the server's dedupe index cannot collapse,
      // so the channel gets two identical messages.
      // An attachment-only message is a real message, so `!body` alone is not
      // an empty send — web fixed exactly this once (`composer.tsx`: "An
      // attachment-only message is a real message"). Leaving the old guard
      // here would return silently with the chips still on screen and no
      // error, which is the worst of the three outcomes.
      if (
        !channelId ||
        !ctx ||
        (!body && staged.length === 0) ||
        sendingRef.current
      )
        return false;
      sendingRef.current = true;
      let queued = false;
      const forChannelId = channelId;
      const generation = ++sendGenerationRef.current;
      // Cancel the debounce first, or a keystroke from under 400ms ago
      // re-persists the draft after the send has already cleared it.
      cancelDraftTimer();
      // Clear optimistically so the composer empties the instant the bubble
      // appears, then put the text back if the send never got anywhere.
      setDraftState("");
      if (staged.length > 0) {
        setAttachments((current) =>
          current.filter((row) => !staged.includes(row)),
        );
      }
      setSendError(null);
      try {
        await sendMessage(ctx, {
          channelId,
          content: body,
          replyToId: options?.replyToId ?? null,
          attachments: staged.length > 0 ? staged : undefined,
        });
        queued = true;
        await drafts.clear(channelId);
      } catch (error) {
        // `sendMessage` rethrows when `outbox.enqueue` fails, after taking its
        // optimistic bubble back out (#1718), so a full or unavailable
        // AsyncStorage lands here with nothing queued and nothing on screen.
        // There is no toast on this platform, so restoring the text and naming
        // the failure is the only way the member learns their message did not
        // go anywhere — but only onto the channel this send was actually for;
        // see the generation/channel guard above.
        if (
          currentChannelIdRef.current === forChannelId &&
          sendGenerationRef.current === generation
        ) {
          setDraftState(body);
          // Put the claims back too, or the member loses a photo that is
          // still sitting in the bucket with no way to reach it again.
          if (staged.length > 0) {
            setAttachments((current) => [...staged, ...current]);
          }
          setSendError(
            error instanceof Error && error.message
              ? error.message
              : "Couldn't queue that message. Try again.",
          );
        }
      } finally {
        sendingRef.current = false;
      }
      return queued;
    },
    [attachments, cancelDraftTimer, channelId, ctx, drafts],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      if (!channelId || !ctx) {
        throw new Error("Couldn't edit message. Try again.");
      }
      await withFailureMessage(
        (onError) =>
          editMessage({ ...ctx, onError }, { channelId, messageId, content }),
        "Couldn't edit message. Try again.",
      );
    },
    [channelId, ctx],
  );

  const remove = useCallback(
    async (messageId: string) => {
      if (!channelId || !ctx) {
        throw new Error("Couldn't delete message. Try again.");
      }
      await withFailureMessage(
        (onError) =>
          deleteMessage({ ...ctx, onError }, { channelId, messageId }),
        "Couldn't delete message. Try again.",
      );
    },
    [channelId, ctx],
  );

  const addAttachment = useCallback((attachment: OutboxAttachment) => {
    setAttachments((current) => [...current, attachment]);
  }, []);

  const removeAttachment = useCallback((storagePath: string) => {
    setAttachments((current) =>
      current.filter((row) => row.storagePath !== storagePath),
    );
  }, []);

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId) return;
      await reactWithErrorSink(reactAction, { channelId, messageId, emoji });
    },
    [channelId, reactWithErrorSink],
  );

  const unreact = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId) return;
      await reactWithErrorSink(unreactAction, { channelId, messageId, emoji });
    },
    [channelId, reactWithErrorSink],
  );

  const act = useCallback(
    async (
      messageId: string,
      actionType: string,
      payload?: Record<string, unknown>,
    ) => {
      if (!channelId) return;
      await actWithErrorSink({ channelId, messageId, actionType, payload });
    },
    [channelId, actWithErrorSink],
  );

  const emitTyping = useCallback(() => {
    if (!channelId || !viewerId) return;
    chatRealtime.emitTyping(channelId, viewerId);
  }, [channelId, viewerId]);

  /** The port has no get-by-id, so the row is found through its channel list. */
  const findOutboxRow = useCallback(
    async (clientMessageId: string) => {
      if (!channelId) return undefined;
      const rows = await outbox.listForChannel(channelId);
      return rows.find((row) => row.clientId === clientMessageId);
    },
    [channelId, outbox],
  );

  const retry = useCallback(
    async (clientMessageId: string) => {
      if (!ctx) return;
      const row = await findOutboxRow(clientMessageId);
      if (row) await retryOutboxRow(ctx, row);
    },
    [ctx, findOutboxRow],
  );

  const discard = useCallback(
    async (clientMessageId: string) => {
      if (!ctx) return;
      const row = await findOutboxRow(clientMessageId);
      if (row) await discardOutboxRow(ctx, row);
    },
    [ctx, findOutboxRow],
  );

  // Best-effort flush whenever this channel's connection comes live. The runtime
  // also flushes on boot and on every reconnect; this covers the case where the
  // socket recovers without the platform reporting a connectivity flip.
  useEffect(() => {
    if (connection !== "live" || !ctx) return;
    void flushOutbox(ctx);
  }, [connection, ctx]);

  const messages = useMemo(() => selectMessages(query.data), [query.data]);

  return {
    messages,
    isLoading: query.isPending,
    loadError: query.error ?? null,
    reload,
    isReloading: query.isFetching,
    ...olderHistoryView(pagerState, channelId, query.data),
    loadOlder,
    viewerId,
    canSend: !!ctx && !!channelId,
    send,
    edit,
    remove,
    react,
    unreact,
    act,
    attachments,
    addAttachment,
    removeAttachment,
    draft,
    setDraft,
    sendError,
    reactionError,
    clearReactionError,
    actionError,
    clearActionError,
    typingUsers,
    emitTyping,
    connection,
    retry,
    discard,
  };
}
