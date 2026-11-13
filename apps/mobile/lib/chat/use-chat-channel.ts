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
 * 4. **No slash dispatch.** Slash commands are not a mobile surface, so
 *    `unconfirmed`/`recorded` rows have no replay path; the thread presents
 *    them read-only (#1910) until one exists. Do not invent a slash dispatch
 *    from here. The + sheet's forms (#3865) do post through
 *    `@repo/chat-core/dispatch`'s `postPoll`, `postTask`, `postHours` and
 *    `trackEventCard`, the calls web's commands make; none of them replays.
 *    Web's `dispatchSlash`, `retryUnconfirmed` and the persisted-notice merge
 *    in its channel query all hang off slash dispatch.
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

import type { ChatMessageFlag } from "@repo/validation";
import { errorCopy, MemberFacingError } from "@repo/hooks/error-copy";
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
  closePoll as closePollAction,
  closeCard as closeCardAction,
  setMessageFlag as setMessageFlagAction,
  deleteMessage,
  discardOutboxRow,
  editMessage,
  flushOutbox,
  hydrateOutboxIntoCache,
  react as reactAction,
  retryOutboxRow,
  AttachmentsNotReadyError,
  sendMessage,
  unreact as unreactAction,
  type CardActionArgs,
  type ChatErrorFn,
} from "@repo/chat-core/chat-client";
import {
  emptyCache,
  removeMessage,
  selectMessages,
} from "@repo/chat-core/cache";
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
  type OutgoingGif,
} from "@repo/chat-core/types";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import type { PollPayload } from "@repo/chat-core/polls";
import type { SignupPayload } from "@repo/chat-core/signups";
import {
  postHours,
  postPoll,
  postSignup,
  postTask,
  SIGNED_OUT_POST_COPY,
  trackEventCard,
  type DispatchResult,
  type EventCardTrack,
  type HoursInput,
  type TaskInput,
} from "@repo/chat-core/dispatch";
import { randomClientId } from "@repo/api-sdk";
import type { AttachmentPickResult } from "./attachment-upload";
import {
  attachmentMatchKey,
  forgetLocalPhotos,
  matchLocalPhotos,
  rememberLocalPhotos,
} from "./local-photos";
import { useFrappClient, withChatRecordRefresh } from "@repo/hooks";

import { getSupabaseClient } from "@/lib/supabase";
import { CHANNEL_MESSAGES_GC_TIME, takeReadAhead } from "./prefetch-channel";
import { bootChatAdapters, useChatRuntime } from "./use-chat-runtime";

/** Matches web's debounce so a draft write never rides every keystroke. */
const DRAFT_SAVE_DEBOUNCE_MS = 400;

/** How many photo uploads run at once: enough to fill LTE, few enough to finish in order. */
const PHOTO_UPLOAD_CONCURRENCY = 3;

/** A photo just picked, with the upload that turns it into a claim. */
export interface NewStagedPhoto {
  previewUri: string;
  width: number | null;
  height: number | null;
  /** Never rejects (`uploadChatPhoto`); `cancelled` reads as failed. */
  upload: () => Promise<AttachmentPickResult>;
}

export interface StagedPhoto {
  key: string;
  previewUri: string;
  width: number | null;
  height: number | null;
  status: "uploading" | "ready" | "failed";
  attachment: OutboxAttachment | null;
  /** Why it failed, in a sentence. */
  reason: string | null;
}

interface PendingPhotoSend {
  channelId: string;
  body: string;
  replyToId: string | null;
  /** The photos' keys, in the order the message shows them. */
  keys: string[];
}

interface PhotoJob {
  upload: () => Promise<AttachmentPickResult>;
  /** Which attempt this is: a queued attempt whose job was replaced or removed is skipped. */
  token: object;
  /** Settles with this attempt's claim; rejects with the reason. */
  claim: Promise<OutboxAttachment>;
}

/** Couldn't upload, with no reason given back. */
const PHOTO_FAILED = "A photo didn't upload. Tap it to try again.";

let photoKeySeq = 0;

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
export async function withFailureMessage(
  run: (onError: ChatErrorFn) => Promise<void>,
  fallback: string,
): Promise<void> {
  let described: string | null = null;
  try {
    await run((input) => {
      described = input.description ?? input.title;
    });
  } catch {
    // chat-core already worded it for the member (`classifyChatError`).
    throw new MemberFacingError(described ?? fallback);
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
   * Sends the body *and* whatever `photos` currently holds — the staged
   * list is owned here, not passed in, for the same reason `draft` is: it has
   * to survive a failed send and reset on a channel switch, and both of those
   * are this hook's existing jobs. A photo staged in #general riding the next
   * message in #dues is the bug that shape prevents.
   *
   * Resolves `true` once the message is in the outbox, `false` when nothing
   * was queued (an empty body, an earlier send still in flight, no runtime, or an
   * outbox that refused the row), so a caller holding state for this send (a
   * staged reply) can keep it. Never rejects.
   *
   * Photos still uploading do not hold the send: the message goes up at once
   * with the sender's own pictures, and its outbox write waits for the
   * uploads off the composer (`attachmentsReady` in chat-core), so the next
   * message can be sent straight away. A photo that then fails turns the
   * message into a failed row in its own channel, whose Retry uploads the
   * failed photos again and sends, and whose Discard removes it. A photo
   * already marked failed in the tray holds the send instead, so the member
   * decides: try it again or remove it.
   */
  send: (content: string, options?: SendOptions) => Promise<boolean>;
  /**
   * Whether `send` would refuse a message right now because an earlier one is
   * still in flight. Read at the moment of a tap rather than rendered: `send`
   * claims its re-entry guard synchronously, before its first await, so this
   * is already true for a second tap landing inside the same render.
   */
  sendInFlight: () => boolean;
  /**
   * Posts a poll card (`kind: "poll"`) built by `buildPollMessage`, from s05's
   * New poll sheet (#3701), through chat-core's `postPoll`, the call web's
   * `/poll` makes. It goes through the outbox like any message, so it is
   * optimistic, survives going offline, and a refusal lands as a failed row
   * in the thread with Retry and Discard. It touches neither the draft nor
   * the photo tray. Resolves once the card is queued, with `warning` when it
   * posted but wasn't saved on this phone, or with the reason it couldn't be
   * (signed out, or an outbox that refused the row). Never rejects.
   */
  sendPoll: (poll: {
    content: string;
    payload: PollPayload;
  }) => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>;
  /**
   * The + sheet's New sign-up sheet (#3926): a `kind: "signup"` card into this
   * channel through chat-core's `postSignup`, the call web's form makes, with
   * `sendPoll`'s outcomes. Never rejects.
   */
  sendSignup: (signup: {
    content: string;
    payload: SignupPayload;
  }) => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>;
  /**
   * The + sheet's GIF picker (#4631): the GIF as its own message, through
   * the outbox like any message. It touches neither the draft nor the photo
   * tray. Never rejects; resolves `ok: false` with the reason it couldn't
   * queue.
   */
  sendGif: (
    gif: OutgoingGif,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * The + sheet's Task and Service hours forms (#3865): chat-core's
   * `postTask` / `postHours` into this channel, the calls web's `/task` and
   * `/hours log` make, so the card gets the same placeholder, the `recorded`
   * row when it didn't post, and `unconfirmed` (never `ok: false`) when the
   * answer was lost. Neither route dedupes, so a form closes on anything but
   * `ok: false`. Never rejects.
   */
  postTask: (input: TaskInput) => Promise<DispatchResult>;
  postHours: (input: HoursInput) => Promise<DispatchResult>;
  /**
   * The + sheet's Event form: chat-core's `trackEventCard` for this channel,
   * the timeline bookkeeping for a card the form's own `POST /v1/events`
   * asks the server to post. `null` while there's no channel or identity.
   */
  trackEventCard: ((name: string) => EventCardTrack) | null;
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
  /**
   * Closes the viewer's own poll card early (#3794). Pessimistic like
   * `remove`: the card draws closed when the server row lands. Rejects with a
   * member-facing message on failure, and changes nothing.
   */
  closePoll: (messageId: string) => Promise<void>;
  /** Closes a sign-up card early (#3926), pessimistic like `closePoll`. */
  closeSignup: (messageId: string) => Promise<void>;
  /**
   * Puts a flag on a message, replaces it, or (`null`) takes it off (#3921).
   * Pessimistic like `closePoll`: the row draws the flag when the server's
   * answer lands. Rejects with a member-facing message, a lost race included.
   */
  flag: (messageId: string, flag: ChatMessageFlag | null) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  unreact: (messageId: string, emoji: string) => Promise<void>;
  /** Inline-card action dispatch (poll votes, #528; RSVP/Done in a future card). */
  act: (
    messageId: string,
    actionType: string,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  /**
   * Photos staged for the next send, in the order picked: uploading in the
   * background, ready (the bytes are in the bucket, `attachment` is the
   * claim), or failed with a reason. Removing a ready one drops the claim,
   * not the object.
   */
  photos: StagedPhoto[];
  /** Stage freshly picked photos; each starts uploading at once. */
  addPhotos: (photos: NewStagedPhoto[]) => void;
  removePhoto: (key: string) => void;
  /** Start a failed photo's upload again. */
  retryPhoto: (key: string) => void;
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
    // Kept for half an hour after the screen leaves, not TanStack's default
    // five minutes (2026-11-07). Opening a channel from a push eight minutes
    // after last reading it found the cache collected and drew the skeleton
    // for the whole cold read (3 s on prod that evening, the read queued
    // behind the resume burst). Kept, the rows paint at once and the
    // realtime join's backfill reads what arrived since (`mergeSincePage`).
    // Chat home reads ahead into this same key with the same life
    // (`prefetch-channel.ts`, #3699).
    gcTime: CHANNEL_MESSAGES_GC_TIME,
    queryFn: () => (channelId ? pager.readNewest(channelId) : emptyCache()),
  });

  const { refetch } = query;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  // A page chat home read ahead (#3699) paints at once, then is read again
  // here behind the rows already shown: nothing kept it current while no
  // thread had the channel open, and this read, through the pager, is the one
  // that records where a short channel's history starts.
  const hasData = query.data !== undefined;
  useEffect(() => {
    if (!channelId || !hasData) return;
    if (takeReadAhead(channelId)) void refetch();
  }, [channelId, hasData, refetch]);

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
  /**
   * The composer's text as of the last keystroke, readable from inside a send
   * that is still awaiting its POST. A send settling reads this to tell the
   * text it sent from a new message the member started meanwhile (#4141).
   */
  const latestDraftRef = useRef("");
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  /**
   * The upload behind each staged photo, by key. A ref, because a send reads
   * the claims at the moment of the tap, and a status landing between the
   * tap and the next render must not be missed.
   */
  const photoJobsRef = useRef(new Map<string, PhotoJob>());
  /**
   * The newest state of every photo staged or riding a pending send, kept
   * past the tray, so a send that waits on uploads reads each one as it now
   * stands.
   */
  const latestPhotoRef = useRef(new Map<string, StagedPhoto>());
  /** Uploads waiting for a slot, oldest first, and how many are running. */
  const photoQueueRef = useRef<(() => void)[]>([]);
  const photoRunningRef = useRef(0);
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    void drafts.load(channelId).then((body) => {
      if (cancelled) return;
      latestDraftRef.current = body;
      setDraftState(body);
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
    // leaves the object an orphan (nothing collects an upload no message
    // claimed until #2197). Carrying it across the switch
    // would be the worse failure — the photo would ride the next message in a
    // channel it was never meant for.
    if (photos.length > 0) setPhotos([]);
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
            setActionError(input.description ?? input.title);
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
      latestDraftRef.current = body;
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

  /** Photos a send has taken out of the tray whose message isn't confirmed yet. */
  const sentPhotoKeysRef = useRef(new Set<string>());
  /**
   * Messages sent while their photos were still uploading, by client id,
   * until the server confirms them. Holds what Retry needs, since nothing is
   * in the outbox until every upload lands.
   */
  const pendingPhotoSendsRef = useRef(new Map<string, PendingPhotoSend>());

  const settlePendingPhotoSend = useCallback((clientMessageId: string) => {
    const pending = pendingPhotoSendsRef.current.get(clientMessageId);
    if (!pending) return;
    pendingPhotoSendsRef.current.delete(clientMessageId);
    for (const key of pending.keys) {
      sentPhotoKeysRef.current.delete(key);
      photoJobsRef.current.delete(key);
      latestPhotoRef.current.delete(key);
    }
  }, []);

  /**
   * Send (or send again) a message whose photos may still be uploading. The
   * first send clears the channel's saved draft, since the draft is what it
   * sends; a Retry keeps it, because whatever is saved by then is a newer
   * message the member is still writing.
   */
  const runPendingPhotoSend = useCallback(
    (clientMessageId: string, options?: { retry?: boolean }) => {
      const pending = pendingPhotoSendsRef.current.get(clientMessageId);
      if (!pending || !ctx) return;
      const attachmentsReady = Promise.all(
        pending.keys.map((key) => {
          const job = photoJobsRef.current.get(key);
          const latest = latestPhotoRef.current.get(key);
          if (latest?.status === "ready" && latest.attachment) {
            return Promise.resolve(latest.attachment);
          }
          return job ? job.claim : Promise.reject(new Error(PHOTO_FAILED));
        }),
      ).then((claims) => {
        matchLocalPhotos(
          clientMessageId,
          claims.map((claim) =>
            attachmentMatchKey(claim.filename, claim.byteSize),
          ),
        );
        return claims;
      });
      void sendMessage(ctx, {
        channelId: pending.channelId,
        content: pending.body,
        replyToId: pending.replyToId,
        clientMessageId,
        attachmentsReady,
        attachmentCount: pending.keys.length,
        keepDraft: options?.retry === true,
      })
        .then(() => settlePendingPhotoSend(clientMessageId))
        .catch((error: unknown) => {
          // A failed upload leaves the row failed in its channel, and this
          // entry for Retry. Anything else is a failed enqueue, which took the
          // row back out: there is nothing left to retry.
          if (error instanceof AttachmentsNotReadyError) return;
          settlePendingPhotoSend(clientMessageId);
          forgetLocalPhotos(clientMessageId);
          if (currentChannelIdRef.current === pending.channelId) {
            setSendError(
              error instanceof Error && error.message
                ? error.message
                : "Couldn't queue that message. Try again.",
            );
          }
        });
    },
    [ctx, settlePendingPhotoSend],
  );

  const send = useCallback(
    async (content: string, options?: SendOptions) => {
      const body = content.trim();
      // Snapshotted before the await, and cleared by identity afterwards: a
      // photo that finishes uploading while this send is in flight must not be
      // cleared as though it had been claimed.
      const staged = photos;
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
      // A failed photo holds the send: sending without it would quietly drop
      // a picture the member can still see in the tray.
      if (staged.some((photo) => photo.status === "failed")) {
        setSendError(
          staged.filter((photo) => photo.status === "failed").length === 1
            ? "A photo didn't upload. Tap it to try again, or remove it."
            : "Some photos didn't upload. Tap them to try again, or remove them.",
        );
        return false;
      }
      // Two taps in one tick read the same tray: the second finds its photos
      // already taken by the first.
      if (staged.some((photo) => sentPhotoKeysRef.current.has(photo.key))) {
        return false;
      }
      const allReady = staged.every(
        (photo) => photo.status === "ready" && photo.attachment,
      );
      const clientMessageId = randomClientId();
      rememberLocalPhotos(
        clientMessageId,
        staged.map((photo) => ({
          uri: photo.previewUri,
          width: photo.width,
          height: photo.height,
          match: photo.attachment
            ? attachmentMatchKey(
                photo.attachment.filename,
                photo.attachment.byteSize,
              )
            : null,
        })),
      );

      // Photos still uploading: the message goes up now and its uploads finish
      // behind it, off the composer. Nothing here is awaited, so the composer
      // (and `sendInFlight`) are free for the next message at once, in this
      // channel or any other. A photo that fails turns the row into a failed
      // one in its own channel, with Retry and Discard (`retry` / `discard`
      // below), never a restore into a composer the member has moved on from.
      if (staged.length > 0 && !allReady && !sendingRef.current) {
        const keys = staged.map((photo) => photo.key);
        for (const key of keys) sentPhotoKeysRef.current.add(key);
        pendingPhotoSendsRef.current.set(clientMessageId, {
          channelId,
          body,
          replyToId: options?.replyToId ?? null,
          keys,
        });
        cancelDraftTimer();
        latestDraftRef.current = "";
        setDraftState("");
        setSendError(null);
        const sent = new Set(keys);
        setPhotos((current) => current.filter((photo) => !sent.has(photo.key)));
        runPendingPhotoSend(clientMessageId);
        return true;
      }

      sendingRef.current = true;
      let queued = false;
      const forChannelId = channelId;
      const generation = ++sendGenerationRef.current;
      // Cancel the debounce first, or a keystroke from under 400ms ago
      // re-persists the draft after the send has already cleared it.
      cancelDraftTimer();
      // Clear optimistically so the composer empties the instant the bubble
      // appears, then put the text back if the send never got anywhere.
      latestDraftRef.current = "";
      setDraftState("");
      if (staged.length > 0) {
        const keys = new Set(staged.map((photo) => photo.key));
        setPhotos((current) => current.filter((photo) => !keys.has(photo.key)));
      }
      setSendError(null);
      try {
        await sendMessage(ctx, {
          channelId,
          content: body,
          replyToId: options?.replyToId ?? null,
          clientMessageId,
          attachments:
            staged.length > 0
              ? staged.map((photo) => photo.attachment!)
              : undefined,
        });
        for (const photo of staged) {
          photoJobsRef.current.delete(photo.key);
          latestPhotoRef.current.delete(photo.key);
        }
        queued = true;
        // Only when the composer is still empty. A member who started the
        // next message while this POST was out has text on screen and a
        // debounced save writing it; clearing here would delete that save, so
        // the new message would be gone the next time the channel opened
        // (#4141). chat-core already cleared the sent draft before the POST.
        if (!latestDraftRef.current.trim()) await drafts.clear(channelId);
      } catch (error) {
        // `sendMessage` rethrows when `outbox.enqueue` fails, after taking its
        // optimistic bubble back out (#1718), so a full or unavailable
        // AsyncStorage lands here with nothing queued and nothing on screen.
        // There is no toast on this platform, so restoring the text and naming
        // the failure is the only way the member learns their message did not
        // go anywhere — but only onto the channel this send was actually for;
        // see the generation/channel guard above.
        forgetLocalPhotos(clientMessageId);
        if (
          currentChannelIdRef.current === forChannelId &&
          sendGenerationRef.current === generation
        ) {
          if (latestDraftRef.current.trim()) {
            // The member has started the next message since: putting this
            // one back would overwrite what they are typing (#4141), and
            // merging the two would pair this message's photos and text with
            // words never written for them. Keep their typing and say plainly
            // that the earlier message is gone, as web's toast does.
            setSendError(
              "Your last message couldn't be queued and was discarded. Re-enter it to try again.",
            );
          } else {
            latestDraftRef.current = body;
            setDraftState(body);
            // Put the photos back too, or the member loses a photo that is
            // still sitting in the bucket with no way to reach it again.
            if (staged.length > 0) {
              setPhotos((current) => [...staged, ...current]);
            }
            setSendError(
              errorCopy(error, "Couldn't queue that message. Try again."),
            );
          }
        }
      } finally {
        sendingRef.current = false;
      }
      return queued;
    },
    [photos, cancelDraftTimer, channelId, ctx, drafts, runPendingPhotoSend],
  );
  const sendInFlight = useCallback(() => sendingRef.current, []);

  const sendPoll = useCallback(
    async (poll: {
      content: string;
      payload: PollPayload;
    }): Promise<
      { ok: true; warning?: string } | { ok: false; error: string }
    > => {
      // The sheet opens only while the composer can send, so no runtime by the
      // time Post lands means the viewer is gone: signed out, as on Task.
      if (!channelId || !ctx) return { ok: false, error: SIGNED_OUT_POST_COPY };
      const result = await postPoll(ctx, channelId, poll);
      if (result.ok) return result;
      // `cause` is for error reporting; the sheet shows the sentence.
      return { ok: false, error: result.error };
    },
    [channelId, ctx],
  );

  const sendSignup = useCallback(
    async (signup: {
      content: string;
      payload: SignupPayload;
    }): Promise<
      { ok: true; warning?: string } | { ok: false; error: string }
    > => {
      if (!channelId || !ctx) return { ok: false, error: SIGNED_OUT_POST_COPY };
      const result = await postSignup(ctx, channelId, signup);
      if (result.ok) return result;
      return { ok: false, error: result.error };
    },
    [channelId, ctx],
  );

  const sendGif = useCallback(
    async (
      gif: OutgoingGif,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!channelId || !ctx) return { ok: false, error: SIGNED_OUT_POST_COPY };
      try {
        await sendMessage(ctx, {
          channelId,
          content: "",
          gif,
          keepDraft: true,
        });
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error && error.message
              ? error.message
              : "The GIF didn't send.",
        };
      }
    },
    [channelId, ctx],
  );

  // No channel or identity means no + (the composer can't send), so these,
  // like `sendPoll`, only answer a caller that raced a sign-out.
  const postTaskHere = useCallback(
    async (input: TaskInput): Promise<DispatchResult> => {
      if (!channelId || !ctx) return { ok: false, error: SIGNED_OUT_POST_COPY };
      // `postTask` writes the chat's cache, not the task board's. A lost
      // answer refreshes it too: the task may exist.
      return withChatRecordRefresh(queryClient, "task", () =>
        postTask(ctx, channelId, input),
      );
    },
    [channelId, ctx, queryClient],
  );
  const postHoursHere = useCallback(
    async (input: HoursInput): Promise<DispatchResult> => {
      if (!channelId || !ctx) return { ok: false, error: SIGNED_OUT_POST_COPY };
      // As above, for the Service page's entries.
      return withChatRecordRefresh(queryClient, "hours", () =>
        postHours(ctx, channelId, input),
      );
    },
    [channelId, ctx, queryClient],
  );
  const trackEventCardHere = useMemo(
    () =>
      channelId && ctx
        ? (name: string) => trackEventCard(ctx, channelId, name)
        : null,
    [channelId, ctx],
  );

  const edit = useCallback(
    async (messageId: string, content: string) => {
      if (!channelId || !ctx) {
        throw new MemberFacingError("Couldn't edit message. Try again.");
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
        throw new MemberFacingError("Couldn't delete message. Try again.");
      }
      await withFailureMessage(
        (onError) =>
          deleteMessage({ ...ctx, onError }, { channelId, messageId }),
        "Couldn't delete message. Try again.",
      );
    },
    [channelId, ctx],
  );

  const closePoll = useCallback(
    async (messageId: string) => {
      if (!channelId || !ctx) {
        throw new MemberFacingError("Couldn't close poll. Try again.");
      }
      await withFailureMessage(
        (onError) =>
          closePollAction({ ...ctx, onError }, { channelId, messageId }),
        "Couldn't close poll. Try again.",
      );
    },
    [channelId, ctx],
  );

  const closeSignup = useCallback(
    async (messageId: string) => {
      if (!channelId || !ctx) {
        throw new MemberFacingError("Couldn't close sign-ups. Try again.");
      }
      await withFailureMessage(
        (onError) =>
          closeCardAction({ ...ctx, onError }, { channelId, messageId }),
        "Couldn't close sign-ups. Try again.",
      );
    },
    [channelId, ctx],
  );

  const flag = useCallback(
    async (messageId: string, next: ChatMessageFlag | null) => {
      const failure = next
        ? "Couldn't flag message. Try again."
        : "Couldn't remove flag. Try again.";
      if (!channelId || !ctx) throw new MemberFacingError(failure);
      await withFailureMessage(
        (onError) =>
          setMessageFlagAction(
            { ...ctx, onError },
            { channelId, messageId, flag: next },
          ),
        failure,
      );
    },
    [channelId, ctx],
  );

  const updatePhoto = useCallback(
    (key: string, patch: Partial<StagedPhoto>) => {
      const before = latestPhotoRef.current.get(key);
      if (before) latestPhotoRef.current.set(key, { ...before, ...patch });
      setPhotos((current) =>
        current.map((photo) =>
          photo.key === key ? { ...photo, ...patch } : photo,
        ),
      );
    },
    [],
  );

  const pumpPhotoQueue = useCallback(() => {
    while (
      photoRunningRef.current < PHOTO_UPLOAD_CONCURRENCY &&
      photoQueueRef.current.length > 0
    ) {
      const next = photoQueueRef.current.shift()!;
      photoRunningRef.current += 1;
      next();
    }
  }, []);

  const startPhotoJob = useCallback(
    (key: string, upload: () => Promise<AttachmentPickResult>) => {
      const token = {};
      const claim = new Promise<OutboxAttachment>((resolve, reject) => {
        photoQueueRef.current.push(() => {
          // Removed from the tray, left behind by a channel switch, or
          // replaced by a retry while it waited: costs no request.
          if (photoJobsRef.current.get(key)?.token !== token) {
            reject(new Error(PHOTO_FAILED));
            photoRunningRef.current -= 1;
            pumpPhotoQueue();
            return;
          }
          void upload()
            .then((result) => {
              if (result.status === "attached") {
                updatePhoto(key, {
                  status: "ready",
                  attachment: result.attachment,
                  reason: null,
                });
                resolve(result.attachment);
              } else {
                const reason =
                  result.status === "refused" ? result.reason : PHOTO_FAILED;
                updatePhoto(key, { status: "failed", reason });
                reject(new Error(reason));
              }
            })
            .finally(() => {
              photoRunningRef.current -= 1;
              pumpPhotoQueue();
            });
        });
      });
      // Read by a send, if one is waiting; otherwise the tray shows it.
      claim.catch(() => undefined);
      photoJobsRef.current.set(key, { upload, claim, token });
      pumpPhotoQueue();
    },
    [pumpPhotoQueue, updatePhoto],
  );

  const addPhotos = useCallback(
    (picked: NewStagedPhoto[]) => {
      const staged = picked.map<StagedPhoto>((photo) => ({
        key: `photo-${++photoKeySeq}`,
        previewUri: photo.previewUri,
        width: photo.width,
        height: photo.height,
        status: "uploading",
        attachment: null,
        reason: null,
      }));
      for (const photo of staged) latestPhotoRef.current.set(photo.key, photo);
      setPhotos((current) => [...current, ...staged]);
      staged.forEach((photo, index) =>
        startPhotoJob(photo.key, picked[index]!.upload),
      );
    },
    [startPhotoJob],
  );

  // Photos left in a channel's tray are abandoned on a switch (the tray
  // resets above): drop their jobs, so queued ones never start. Photos riding
  // a pending send keep going, whichever channel is on screen.
  useEffect(() => {
    for (const key of [...photoJobsRef.current.keys()]) {
      if (sentPhotoKeysRef.current.has(key)) continue;
      photoJobsRef.current.delete(key);
      latestPhotoRef.current.delete(key);
    }
  }, [channelId]);

  const removePhoto = useCallback((key: string) => {
    photoJobsRef.current.delete(key);
    latestPhotoRef.current.delete(key);
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  }, []);

  const retryPhoto = useCallback(
    (key: string) => {
      const job = photoJobsRef.current.get(key);
      if (!job) return;
      setSendError(null);
      updatePhoto(key, { status: "uploading", reason: null });
      startPhotoJob(key, job.upload);
    },
    [startPhotoJob, updatePhoto],
  );

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
      const pending = pendingPhotoSendsRef.current.get(clientMessageId);
      if (pending) {
        // Upload again only what didn't upload; the rest keep their claims.
        for (const key of pending.keys) {
          const latest = latestPhotoRef.current.get(key);
          const job = photoJobsRef.current.get(key);
          if (latest?.status === "ready" || !job) continue;
          latestPhotoRef.current.set(key, {
            ...latest!,
            status: "uploading",
            reason: null,
          });
          startPhotoJob(key, job.upload);
        }
        runPendingPhotoSend(clientMessageId, { retry: true });
        return;
      }
      const row = await findOutboxRow(clientMessageId);
      if (row) await retryOutboxRow(ctx, row);
    },
    [ctx, findOutboxRow, runPendingPhotoSend, startPhotoJob],
  );

  const discard = useCallback(
    async (clientMessageId: string) => {
      if (!ctx) return;
      const pending = pendingPhotoSendsRef.current.get(clientMessageId);
      if (pending) {
        settlePendingPhotoSend(clientMessageId);
        forgetLocalPhotos(clientMessageId);
        queryClient.setQueryData<ChannelCache>(
          chatMessagesKey(pending.channelId),
          (cache) => (cache ? removeMessage(cache, clientMessageId) : cache),
        );
        return;
      }
      const row = await findOutboxRow(clientMessageId);
      if (row) await discardOutboxRow(ctx, row);
    },
    [ctx, findOutboxRow, queryClient, settlePendingPhotoSend],
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
    sendInFlight,
    sendPoll,
    sendGif,
    sendSignup,
    postTask: postTaskHere,
    postHours: postHoursHere,
    trackEventCard: trackEventCardHere,
    edit,
    remove,
    closePoll,
    closeSignup,
    flag,
    react,
    unreact,
    act,
    photos,
    addPhotos,
    removePhoto,
    retryPhoto,
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
