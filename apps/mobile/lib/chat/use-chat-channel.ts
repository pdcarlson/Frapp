/**
 * Component-facing facade for a single chat channel on React Native.
 *
 * The mobile counterpart of `apps/web/lib/chat/use-chat-channel.ts`, and the
 * only thing s05 touches: it hides the normalized cache, the realtime manager,
 * the outbox, and the drafts behind arrays and callbacks.
 *
 * Four deliberate differences from the web hook:
 *
 * 1. **`ctx` comes from `useChatRuntime()`**, not from a provider — `app/_layout.tsx`
 *    is a frozen hotspot file, so the runtime is a hook the chat screens call
 *    (`spec/ui/mobile/patterns.md` § Chat). That also means `ctx` is `null` until
 *    the viewer's `users.id` resolves, so every callback here guards on it.
 * 2. **No `toast`.** `ChatActionContext.toast` is optional and mobile supplies
 *    none, so chat-core's failure toasts are silent no-ops. A terminal 4xx
 *    surfaces only as `_status: "failed"` + `_error` in the cache, which the
 *    thread renders inline — that is the whole failure UI on this platform.
 * 3. **No `getOutboxRow`.** That is a web-only extra on the Dexie store; the
 *    port itself only offers `listForChannel`, so retry/discard look the row up
 *    through it.
 * 4. **No slash dispatch.** `@repo/chat-core/dispatch` pulls in
 *    `@repo/chat-integrations`, whose `types`/`require` conditions point at an
 *    unbuilt `dist/` (#989), and slash commands are not a mobile surface.
 *
 * Imports stay subpath-only for the same reason the runtime's do.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  discardOutboxRow,
  flushOutbox,
  hydrateOutboxIntoCache,
  react as reactAction,
  retryOutboxRow,
  sendMessage,
  unreact as unreactAction,
} from "@repo/chat-core/chat-client";
import {
  applyReactionInsert,
  emptyCache,
  mergeServerRows,
  selectMessages,
} from "@repo/chat-core/cache";
import {
  chatRealtime,
  type ConnectionStatus,
} from "@repo/chat-core/realtime-manager";
import {
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
  type RawChatMessage,
  type RawChatMessageAction,
} from "@repo/chat-core/types";
import { useFrappClient } from "@repo/hooks";

import { getSupabaseClient } from "@/lib/supabase";
import { chatDraftStore } from "./draft-store";
import {
  bootChatAdapters,
  chatOutboxStore,
  useChatRuntime,
} from "./use-chat-runtime";

/** Matches web's debounce so a draft write never rides every keystroke. */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

export interface UseChatChannelResult {
  messages: ChatMessage[];
  isLoading: boolean;
  loadError: Error | null;
  /** `null` until the viewer's app user resolves; own-message styling keys off it. */
  viewerId: string | null;
  /** False while `ctx` is null — the composer must disable rather than no-op silently. */
  canSend: boolean;
  send: (content: string) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  unreact: (messageId: string, emoji: string) => Promise<void>;
  draft: string;
  setDraft: (body: string) => void;
  /** Last send failure. `null` once the member edits the draft or retries. */
  sendError: string | null;
  typingUsers: string[];
  emitTyping: () => void;
  connection: ConnectionStatus;
  retry: (clientMessageId: string) => Promise<void>;
  discard: (clientMessageId: string) => Promise<void>;
}

export function useChatChannel(channelId: string | null): UseChatChannelResult {
  const { ctx, viewerId } = useChatRuntime();
  const apiClient = useFrappClient();
  const queryClient = useQueryClient();

  // Initial load: the REST backfill, plus one batched select on
  // `chat_message_actions` so reactions are on the first paint rather than
  // appearing only after a live echo. `applyReactionInsert` is the canonical
  // merge — it also appends the raw row to `message.actions`, which card tallies
  // read, so a local variant that skipped it would render zeroed cards.
  // Read the client directly rather than through `ctx`. `ctx` is null until the
  // viewer's `users.id` resolves, and this query runs on first render with
  // `staleTime: Infinity` and no `supabase` in its key — so sourcing it from
  // `ctx` meant the reaction hydration below was skipped on every cold start and
  // never retried, leaving reactions blank and poll cards at zero until a live
  // action INSERT happened to arrive. Web is not exposed to this because its
  // client comes from a provider, not from `ctx`.
  const supabase = useMemo(() => getSupabaseClient(), []);
  const query = useQuery<ChannelCache, Error>({
    queryKey: channelId ? chatMessagesKey(channelId) : ["chat", "none"],
    enabled: !!channelId,
    staleTime: Infinity,
    queryFn: async () => {
      if (!channelId) return emptyCache();
      const { data, error } = await apiClient.GET(
        "/v1/channels/{id}/messages",
        {
          params: { path: { id: channelId }, query: { limit: 50 } },
        },
      );
      if (error) throw error as Error;
      const rows = Array.isArray(data) ? (data as RawChatMessage[]) : [];
      // Merge onto whatever is already in this key, not onto `emptyCache()`.
      // React Query replaces the key's data when this resolves, and three other
      // writers target the same key while the fetch is in flight: an optimistic
      // send, `hydrateOutboxIntoCache`, and the realtime merge. Starting from
      // empty discarded all of them — a message sent during the initial spinner
      // vanished, and its outbox row had already been dequeued on success, so
      // nothing restored it until a remount. `mergeServerRows` only adds and
      // updates, so keeping the prior cache cannot resurrect anything.
      const previous = queryClient.getQueryData<ChannelCache>(
        chatMessagesKey(channelId),
      );
      let cache = mergeServerRows(previous ?? emptyCache(), rows);

      const messageIds = rows.map((row) => row.id).filter(Boolean);
      if (supabase && messageIds.length > 0) {
        const { data: actions } = await supabase
          .from("chat_message_actions")
          .select("*")
          .in("message_id", messageIds);
        if (actions) {
          let mutated = cache;
          for (const action of actions as RawChatMessageAction[]) {
            mutated = applyReactionInsert(mutated, action);
          }
          cache = mutated;
        }
      }
      return cache;
    },
  });

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
  // they would be pushed notifications for the thread they are reading. Because
  // this screen is a `Tabs.Screen` it stays mounted and the effect never re-runs,
  // so it would persist for the channel's lifetime. Both callbacks hang off one
  // already-resolved promise and run in registration order, and the runtime's
  // effect is declared first (it is called at the top of this hook), so its
  // `configure` is guaranteed to land before this `subscribe`.
  useEffect(() => {
    if (!channelId || !ctx) return;
    let cancelled = false;
    let attached = false;

    void bootChatAdapters().then(() => {
      if (cancelled) return;
      chatRealtime.subscribe(channelId);
      attached = true;
      void hydrateOutboxIntoCache(ctx, channelId);
    });

    return () => {
      cancelled = true;
      // Only release a refcount this effect actually took, or an unmount that
      // races the boot would decrement someone else's subscription.
      if (attached) chatRealtime.unsubscribe(channelId);
    };
  }, [channelId, ctx]);

  const [connection, setConnection] = useState<ConnectionStatus>("live");
  useEffect(() => chatRealtime.subscribeStatus(setConnection), []);

  // The manager pings status listeners on typing-membership changes too, so one
  // subscription drives both the connection pill and the typing line.
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  useEffect(() => {
    if (!channelId) {
      setTypingUsers([]);
      return;
    }
    // `getTypingUsers` builds a fresh array every call, so assigning it
    // unconditionally never hits React's `Object.is` bail-out — and the manager
    // pings status listeners on its 1.5s typing-expiry sweep. Left as-is, the
    // whole thread re-rendered every 1.5s while anyone was typing, rebuilding
    // every visible bubble's StyleSheet. Compare membership and keep the
    // previous array when it has not changed.
    const refresh = () =>
      setTypingUsers((prev) => {
        const next = chatRealtime.getTypingUsers(channelId);
        const same =
          prev.length === next.length &&
          prev.every((id, index) => id === next[index]);
        return same ? prev : next;
      });
    refresh();
    return chatRealtime.subscribeStatus(refresh);
  }, [channelId]);

  // Draft: load once per channel, debounce writes.
  const [draft, setDraftState] = useState("");
  useEffect(() => {
    if (!channelId) {
      setDraftState("");
      return;
    }
    let cancelled = false;
    void chatDraftStore.load(channelId).then((body) => {
      if (!cancelled) setDraftState(body);
    });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  /** Set while a send is in flight; see the re-entry guard in `send`. */
  const sendingRef = useRef(false);
  /** Last send failure, surfaced by the composer since mobile has no toast. */
  const [sendError, setSendError] = useState<string | null>(null);

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
        void chatDraftStore.save(channelId, body);
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [channelId, cancelDraftTimer],
  );

  const send = useCallback(
    async (content: string) => {
      const body = content.trim();
      // `sendingRef`, not state: this guards re-entry within a single tick, and
      // a state flag would not be visible to a second tap landing before the
      // re-render. Without it, a send held open by a slow POST leaves the
      // composer full and the button live, and a second tap generates a *fresh*
      // `client_message_id` — which the server's dedupe index cannot collapse,
      // so the channel gets two identical messages.
      if (!channelId || !ctx || !body || sendingRef.current) return;
      sendingRef.current = true;
      // Cancel the debounce first, or a keystroke from under 400ms ago
      // re-persists the draft after the send has already cleared it.
      cancelDraftTimer();
      // Clear optimistically so the composer empties the instant the bubble
      // appears, then put the text back if the send never got anywhere.
      setDraftState("");
      setSendError(null);
      try {
        await sendMessage(ctx, { channelId, content: body });
        await chatDraftStore.clear(channelId);
      } catch (error) {
        // `sendMessage` awaits `outbox.enqueue` *outside* its own try/catch, so
        // a full or unavailable AsyncStorage rejects out of it having already
        // drawn the optimistic bubble but queued nothing. There is no toast on
        // this platform, so restoring the text and naming the failure is the
        // only way the member learns their message did not go anywhere.
        setDraftState(body);
        setSendError(
          error instanceof Error && error.message
            ? error.message
            : "Couldn't queue that message. Try again.",
        );
      } finally {
        sendingRef.current = false;
      }
    },
    [cancelDraftTimer, channelId, ctx],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId || !ctx) return;
      await reactAction(ctx, { channelId, messageId, emoji });
    },
    [channelId, ctx],
  );

  const unreact = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId || !ctx) return;
      await unreactAction(ctx, { channelId, messageId, emoji });
    },
    [channelId, ctx],
  );

  const emitTyping = useCallback(() => {
    if (!channelId || !viewerId) return;
    chatRealtime.emitTyping(channelId, viewerId);
  }, [channelId, viewerId]);

  /** The port has no get-by-id, so the row is found through its channel list. */
  const findOutboxRow = useCallback(
    async (clientMessageId: string) => {
      if (!channelId) return undefined;
      const rows = await chatOutboxStore.listForChannel(channelId);
      return rows.find((row) => row.clientId === clientMessageId);
    },
    [channelId],
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
    viewerId,
    canSend: !!ctx && !!channelId,
    send,
    react,
    unreact,
    draft,
    setDraft,
    sendError,
    typingUsers,
    emitTyping,
    connection,
    retry,
    discard,
  };
}
