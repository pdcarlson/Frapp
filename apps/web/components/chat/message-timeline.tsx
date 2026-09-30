"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  EmptyState,
  ErrorState,
  Skeleton,
} from "@/components/shared/async-states";
import { Button } from "@/components/ui/button";
import { useTapRevealedMessage } from "@/hooks/use-tap-revealed-message";
import { cn } from "@/lib/utils";
import { COLD_LOAD_MARKS, markColdLoad } from "@/lib/chat/cold-load-marks";
import { BlockedMessageTombstone } from "./blocked-message-tombstone";
import {
  ImageViewer,
  ImageViewerProvider,
  useImageViewer,
} from "./image-viewer";
import { MessageItem } from "./message-item";
import {
  tombstoneCanUnblock,
  type MaskedRefreshState,
} from "@repo/chat-core/blocks";
import type { ChatMessage, ReplayRequest } from "@repo/chat-core/types";
import type { ThreadBlockList } from "@/lib/chat/use-thread-block-list";
import { authorGroupingKey, useAuthorAvatars } from "@repo/hooks";
import { parseInstant } from "@repo/formatting";

const GROUPING_GAP_MS = 5 * 60 * 1000;

/**
 * Widths cycled rather than randomised, for the reason `channel-list.tsx`
 * records one column over: a skeleton that reshuffles on every render flickers,
 * and under Strict Mode it would differ between the two passes.
 *
 * The `false` entries are grouped rows — a run by the same author, which is
 * what a real channel mostly is. They carry no avatar and no header, so the
 * pattern reserves the gutter without drawing into it.
 */
const SKELETON_ROWS: readonly (readonly [boolean, string])[] = [
  [true, "w-[62%]"],
  [false, "w-[38%]"],
  [true, "w-[45%]"],
  [true, "w-[70%]"],
  [false, "w-[52%]"],
  [false, "w-[30%]"],
  [true, "w-[58%]"],
  [true, "w-[40%]"],
  [false, "w-[66%]"],
  [true, "w-[48%]"],
] as const;

/**
 * The signed Discord avatar a row draws, if any.
 *
 * Only for an imported author nobody has linked. A linked row is the member's
 * message (#2878): it draws the member, and keeps its Discord snapshot solely
 * so an unlink can restore it.
 */
export function importedAvatarUrl(
  message: Pick<ChatMessage, "sender_id" | "author_avatar_path">,
  signed: Record<string, string> | undefined,
): string | undefined {
  if (message.sender_id || !message.author_avatar_path) return undefined;
  return signed?.[message.author_avatar_path];
}

/**
 * The cold-load and channel-switch placeholder for the timeline.
 *
 * This replaced a `LoadingState` card, and the swap is the whole point rather
 * than a restyle. `1s` budgets **zero CLS above the composer** and asks for
 * "skeleton with reserved geometry"; a centred `min-h-52` card in a
 * `rounded-xl` border is neither. It occupied a different box from the rows it
 * stood in for, so every first visit to a channel — and `use-chat-channel.ts`
 * keys its query per channel, so *every channel* is a first visit once — paid a
 * shift when the real rows replaced it. That is precisely the "no CLS
 * regressions on channel switch" clause, and it was firing on the happy path.
 *
 * Three things make the geometry actually reserved rather than merely
 * skeleton-shaped:
 *
 * - **Same box metrics as `MessageItem`.** `px-5`, `pb-1`, `pt-4` on a row that
 *   shows a header and `pt-1` on a grouped one, a `w-8` avatar gutter and a
 *   `gap-2.5` beside it. Copied deliberately: a placeholder whose padding is
 *   "close enough" moves the first real row by the difference.
 * - **Bottom-aligned.** The timeline opens at its end (`initialTopMostItemIndex`
 *   is the last row) with the composer pinned below it, so content arrives
 *   against the bottom edge. A top-aligned skeleton would reserve the right
 *   *amount* of space in the wrong *place* and shift everything on swap.
 * - **`overflow-hidden`, not a scroller.** It stands in for a full column, so
 *   the run of rows is deliberately longer than most viewports; letting it
 *   scroll would add a scrollbar that the real virtualized list then removes.
 *
 * `aria-hidden`, like `ChannelListSkeleton`: ten anonymous rectangles are no
 * use to a screen reader. The audible half of the cold load is announced once,
 * by the `role="status"` region `chat-shell.tsx` owns for exactly this reason.
 */
export function MessageTimelineSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full flex-col justify-end overflow-hidden"
    >
      {SKELETON_ROWS.map(([showHeader, width], index) => (
        <div
          key={index}
          // The row metrics `MessageItem` draws, restated so the swap is a
          // repaint and not a reflow.
          className={cn("flex gap-2.5 px-5 pb-1", showHeader ? "pt-4" : "pt-1")}
        >
          <div className="w-8 shrink-0">
            {showHeader ? <Skeleton className="h-8 w-8 rounded-full" /> : null}
          </div>
          <div className="flex min-w-0 max-w-[86%] flex-col items-start">
            {showHeader ? (
              // `message-item.tsx`'s author line: `ml-1`, 12.5px, baseline-aligned.
              <div className="ml-1 flex items-baseline gap-2 text-[12.5px]">
                <Skeleton className="h-[13px] w-24" />
              </div>
            ) : null}
            {/*
              The bubble, not a bare line — this is the half that decides whether
              the geometry is actually reserved.

              A message body is `TextRenderer`'s `mt-1 px-4 py-3
              leading-[25px]` box with a hairline border: 4 + 1 + 12 + 25 + 12 + 1
              = 55px for a single line. A 13px bar in its place reserved about a
              quarter of that, so ten placeholder rows stood in for roughly half
              the height they were replacing and the whole column jumped when the
              real rows landed — the exact shift this component exists to prevent,
              hidden inside a placeholder that looked right.
            */}
            <div className="mt-1 rounded-[18px] rounded-bl-[6px] border border-border px-4 py-3">
              <Skeleton className={cn("h-[25px]", width)} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Virtuoso owns the scroller's DOM and types both wrappers as `div`, so the
 * list semantics are carried by ARIA rather than by `<ul>`/`<li>`. That is why
 * `MessageItem` renders `role="listitem"` on a `div` instead of an `<li>`: a
 * real `<li>` inside Virtuoso's `div` is an orphan list item. (It used to sit
 * inside a genuine `<ul>` in the thread panel too, so the two call sites
 * disagreed about the row's own element; #2142 deleted that panel, and this is
 * now the only caller.)
 */
const TimelineList = forwardRef<
  HTMLDivElement,
  { style?: React.CSSProperties; children?: React.ReactNode }
>(function TimelineList({ style, children }, ref) {
  return (
    <div ref={ref} style={style} role="list">
      {children}
    </div>
  );
});

/**
 * Virtuoso's own scroll container, overridden only to carry
 * `scroll-padding-bottom` (`1b` pin 13: "scroll-padding-bottom keeps focus
 * visible").
 *
 * The composer is pinned to the bottom of the column and the timeline ends
 * flush against it, so a row brought into view by the keyboard — tabbing onto a
 * message's actions, or opening its edit field — landed hard against the
 * composer's top border with nothing between them. `scroll-padding-bottom`
 * reserves a gutter for exactly that: it changes where the browser considers
 * the scrollport to end for `scrollIntoView` and keyboard scrolling, and does
 * nothing to a programmatic `scrollTop`, so Virtuoso's own `scrollToIndex`
 * (pins, saved messages, deep links) is unaffected.
 */
const TimelineScroller = forwardRef<
  HTMLDivElement,
  { style?: React.CSSProperties; children?: React.ReactNode }
>(function TimelineScroller({ style, children, ...rest }, ref) {
  return (
    <div ref={ref} style={style} className="scroll-pb-6" {...rest}>
      {children}
    </div>
  );
});

/**
 * Where Virtuoso's index space starts. Prepending older history (#1571) lowers
 * `firstItemIndex` by the rows it added, which is how Virtuoso keeps the rows
 * on screen where they are instead of jumping to the top; it must stay
 * positive, and no member scrolls back a hundred million rows.
 */
const FIRST_ITEM_INDEX_BASE = 100_000_000;

/**
 * The index of the first row, lowered by what a load prepended, and whether
 * the rows as they stand arrived by a prepend.
 *
 * Derived by comparing the drawn keys with the previous render's, during
 * render, so the new data and its index reach Virtuoso in the same pass —
 * an effect would hand it one frame of new rows at the old index, which is
 * the jump this exists to prevent. Rows can also leave the top (a refetch
 * that could not keep the older pages); then the index rises by as many.
 * A change at neither edge (a channel switch) leaves it where it is.
 *
 * `prepended` exists for `followOutput`. Virtuoso follows a count increase
 * while the list is at the bottom, and a page prepended while the member sits
 * there raises the count too: followed, it snapped the list back to the
 * bottom half a second after a jump had scrolled to the message it paged back
 * for.
 */
function usePrependAwareFirstIndex(keys: readonly string[]): {
  firstItemIndex: number;
  prepended: boolean;
} {
  const [tracked, setTracked] = useState<{
    keys: readonly string[];
    firstItemIndex: number;
    prependedAt: readonly string[] | null;
  }>({ keys, firstItemIndex: FIRST_ITEM_INDEX_BASE, prependedAt: null });
  if (tracked.keys === keys) {
    return {
      firstItemIndex: tracked.firstItemIndex,
      prepended: tracked.prependedAt === keys,
    };
  }
  let firstItemIndex = tracked.firstItemIndex;
  let prependedAt: readonly string[] | null = null;
  const previousFirst = tracked.keys[0];
  const nextFirst = keys[0];
  if (previousFirst !== undefined && nextFirst !== undefined) {
    const prepended = keys.indexOf(previousFirst);
    const removed = prepended < 0 ? tracked.keys.indexOf(nextFirst) : -1;
    if (prepended > 0) {
      firstItemIndex -= prepended;
      prependedAt = keys;
    } else if (removed > 0) {
      firstItemIndex += removed;
    }
  }
  setTracked({ keys, firstItemIndex, prependedAt });
  return { firstItemIndex, prepended: prependedAt === keys };
}

/** What the row above the oldest loaded message says, if anything. */
interface TimelineHeaderContext {
  olderStatus: "idle" | "loading" | "error";
  onRetryOlder?: () => void;
}

/**
 * The row above the oldest loaded message: the older-history read in flight,
 * or its failure with a Retry. Nothing otherwise — the day divider under it
 * already says where the history starts.
 */
function TimelineHeader({ context }: { context?: TimelineHeaderContext }) {
  if (context?.olderStatus === "loading") {
    return (
      <p
        role="status"
        className="py-3 text-center text-[12.5px] text-muted-foreground"
      >
        Loading earlier messages...
      </p>
    );
  }
  if (context?.olderStatus === "error") {
    return (
      <div className="flex items-center justify-center gap-2 py-3">
        <p role="alert" className="text-[12.5px] text-muted-foreground">
          Couldn&apos;t load earlier messages.
        </p>
        {context.onRetryOlder ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-8"
            onClick={context.onRetryOlder}
          >
            Retry
          </Button>
        ) : null}
      </div>
    );
  }
  return null;
}

/** Local calendar day, so "yesterday" breaks where the reader's day breaks. */
function dayKey(iso: string): string {
  const at = parseInstant(iso);
  if (!at) return "";
  return `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
}

function dayLabel(iso: string): string {
  const at = new Date(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(iso) === today) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * What the shell can ask the timeline to do. Narrow on purpose: the timeline
 * owns the virtualizer, so scrolling is its job, and the shell only names a
 * message.
 */
export interface MessageTimelineHandle {
  /**
   * Scrolls to a message, returning whether it was actually reachable.
   *
   * It no-ops for a message outside the loaded window and says so, because
   * callers cannot otherwise tell "scrolled" from "did nothing". Pins could
   * ignore that (a pin you can see is by definition loaded); search cannot,
   * since its whole purpose is reaching messages beyond the window. The shell
   * answers a `false` by loading older history and asking again (#1571).
   */
  scrollToMessage: (messageId: string) => boolean;
}

export interface MessageTimelineProps {
  /** Undefined while no channel is selected — avatar resolution just no-ops. */
  channelId: string | undefined;
  /**
   * Every cached message, held and tombstoned ones included. What is *drawn*
   * comes from `blockList.thread`; this is only the lookup a reply quote
   * classifies its parent from, so a reply can tell "hidden by your block
   * list" from "not loaded".
   */
  messages: ChatMessage[];
  /**
   * The viewer's block list applied to `messages` (`useThreadBlockList`, #2313).
   * Required: the timeline draws `blockList.thread.rows` and nothing else, so a
   * caller cannot render a thread with the list forgotten — that would fail
   * open on a safety feature. A blocked sender's rows come through as
   * tombstones, and rows the list cannot vouch for yet are held out entirely.
   */
  blockList: Pick<ThreadBlockList, "blockState" | "thread">;
  /** A tombstone's Unblock: asks, then unblocks the sender. */
  onUnblock: (userId: string) => void;
  /** A stale tombstone's Reload: re-runs that sender's post-unblock re-read. */
  onReloadMasked: (userId: string) => void;
  /** Each member's post-unblock re-read (`useMaskedRefresh`), for stale tombstones. */
  maskedRefresh: ReadonlyMap<string, MaskedRefreshState>;
  /**
   * The signed-in member's `users.id`, or `null` while `GET /v1/users/me` has
   * not answered yet.
   *
   * `null` is a *third* state here and not a viewer, which is the whole of
   * #2243: it reaches this component ahead of the id on a regular basis, because
   * the first chunk paints rows out of IndexedDB (#2227) while identity is still
   * on the network. It is handled by withholding rows rather than by guessing —
   * see the gate below — so `MessageItem` can take a plain `string`.
   */
  viewerId: string | null;
  /** Resolves `users.id` → display name; `null` when unresolvable. */
  nameFor: (userId: string) => string | null;
  isLoading: boolean;
  loadError: Error | null;
  onRetryLoad?: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  /** Stages an inline reply in the composer — the row's Reply control (#489). */
  onReply?: (message: ChatMessage) => void;
  /**
   * Scrolls this timeline to the message a reply quotes — what the quote above
   * a reply does. It opened a Details-rail thread panel until #2142 deleted
   * both.
   */
  onJumpToParent?: (message: ChatMessage) => void;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
  /** Replays an `unconfirmed` heavy-command row under its original key (#1733). */
  onRetryUnconfirmed?: (replay: ReplayRequest) => void | Promise<void>;
  onAct?: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => void;
  /**
   * Message ids the viewer has bookmarked (#462). A set rather than a
   * per-message flag so the virtualized list looks each row up in O(1) without
   * the caller rebuilding an array of props per render.
   */
  bookmarkedMessageIds?: Set<string>;
  onToggleBookmark?: (messageId: string, next: boolean) => void;
  canManageChannel?: boolean;
  /**
   * Older history (#1571). The timeline asks for the next page when the member
   * reaches the top of what is loaded, while `hasOlder` says there may be one.
   */
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  olderError?: boolean;
  onLoadOlder?: () => void;
  /**
   * A jump is on its way to a message in this channel, so a growing list must
   * not be followed to its newest row. Following fires when the count rises
   * while the list sits at its bottom, which is exactly what switching from a
   * short channel into a long one looks like, and it cancelled the jump's
   * scroll a moment after the jump had reported success.
   */
  holdFollow?: boolean;
}

/**
 * Virtualized message timeline. Messages within 5 minutes from the same author
 * collapse their header (Slack-style grouping). Empty / loading / error all
 * render explicit states — never a blank pane.
 *
 * **Grouping survives the Signet cutover, deliberately.** `components.md` §11
 * carries a TODO-DESIGN saying consecutive messages from one sender are not
 * drawn, and that until they are, "every message renders that full chrome".
 * That is guidance for a surface with no answer, not a ban on one that already
 * shipped: the reference draws no grouped run to contradict, and a dashboard
 * feed that repeats an avatar and a name on every line of a burst is noisier,
 * not more correct. A grouped follow-on renders its bubble with the meta
 * chrome suppressed, which is the same shape mobile would take if it grouped.
 */
export const MessageTimeline = forwardRef<
  MessageTimelineHandle,
  MessageTimelineProps
>(function MessageTimeline(
  {
    channelId,
    messages,
    blockList,
    onUnblock,
    onReloadMasked,
    maskedRefresh,
    viewerId,
    nameFor,
    isLoading,
    loadError,
    onRetryLoad,
    onReact,
    onUnreact,
    onReply,
    onJumpToParent,
    onRetry,
    onDiscard,
    onRetryUnconfirmed,
    onAct,
    onEdit,
    onDelete,
    bookmarkedMessageIds,
    onToggleBookmark,
    canManageChannel,
    hasOlder = false,
    isLoadingOlder = false,
    olderError = false,
    onLoadOlder,
    holdFollow = false,
  },
  ref,
) {
  const virtuoso = useRef<VirtuosoHandle | null>(null);

  /*
    `1s`: "cached channel readable <= 400ms".

    In an effect, not in the render body, and both halves of that are deliberate.
    An effect runs after React has committed the rows to the DOM, which is what
    "readable" means; marking during render would timestamp the moment React
    began producing them and quietly under-report the budget it exists to check.
    And a mark is a side effect, so the render path is the wrong place for it
    regardless — under Strict Mode the double render calls it twice, and only
    `markColdLoad`'s own dedupe would be holding the number together.

    Excluding `loadError` matters more than it looks. A channel that failed to
    load is not readable, and counting it would fold fast failures into the same
    metric as fast successes — the one direction that makes a latency number look
    better the more often the product breaks. An *empty* channel does count: it
    is readable, it just has nothing in it.

    `viewerUnresolved` is excluded on the same principle, and it is the half that
    keeps this number honest after #2243. Rows the member cannot trust the
    authorship of are not readable either — that is the bug, not a cosmetic
    detail — so a mark taken while identity was still in flight would be
    timing a timeline that was about to reattribute half its rows.
  */
  // `!viewerId` rather than `=== null`: the prop's declared type says `null`, but
  // a JSX spread of a loosely-typed object is not prop-checked, so a caller can
  // hand this `undefined` with the compiler silent — and `undefined === null` is
  // false, which would open the gate and paint every row as another member's
  // again. An unusable id is an unresolved viewer whatever shape it arrives in.
  const viewerUnresolved = !viewerId;
  const readable = !isLoading && !loadError && !viewerUnresolved;
  useEffect(() => {
    if (readable) markColdLoad(COLD_LOAD_MARKS.channelReadable);
  }, [readable]);

  const { blockState, thread } = blockList;

  // The messages the list lets the timeline draw in full. A tombstone draws no
  // author, so it asks for no avatar either.
  const visibleMessages = useMemo(
    () =>
      thread.rows
        .filter((row) => row.visibility === "visible")
        .map((row) => row.message),
    [thread.rows],
  );

  // The image viewer (#2874) lives here, above the virtualized rows, so a row
  // scrolling out of the window can't take an open viewer with it. It closes
  // when its message stops being drawn in full: deleted, masked or held by the
  // block list, or gone from the loaded window. Reset during render, so no
  // frame draws an image the thread no longer shows.
  const imageViewer = useImageViewer();
  const viewedMessageId = imageViewer.target?.messageId;
  if (
    viewedMessageId &&
    !visibleMessages.some(
      (message) => message.id === viewedMessageId && !message.is_deleted,
    )
  ) {
    imageViewer.close();
  }

  // One batched request for every distinct imported-author avatar visible in
  // this window, rather than one per message (#1231). A miss (no avatar, out
  // of chapter, or unsigned) just means that row keeps its initials fallback.
  const avatars = useAuthorAvatars(channelId, visibleMessages);

  // Which row's action cluster a tap revealed — one id for the whole list, so
  // tapping a second row dismisses the first's, matching the reference
  // affordance (#1193). Same key basis as `computeItemKey` below.
  const tapRevealed = useTapRevealedMessage();

  // Parent lookup for reply quotes (#489), built once per message list rather
  // than scanned per row: the timeline is virtualized but `decorated` is mapped
  // over the whole window, so a `find` inside it would be O(n²) on a long
  // channel. Built over every cached message, held and tombstoned ones
  // included, so `MessageItem` can classify a parent the list hides and quote
  // its placeholder rather than "not loaded" (#2313).
  const byId = useMemo(() => {
    const index = new Map<string, ChatMessage>();
    for (const message of messages) index.set(message.id, message);
    return index;
  }, [messages]);

  // Precompute "showHeader" so we don't recompute per render in the renderer.
  // Over the rows the list lets through: a held row is not drawn, so it
  // neither breaks nor joins a group.
  const decorated = useMemo(() => {
    return thread.rows.map(({ message, visibility }, index) => {
      const prevRow = thread.rows[index - 1];
      const prev = prevRow?.message;
      // Keyed, not compared on `sender_id` directly: that column is nullable
      // now, and `null === null` is true in JS — so an imported archive channel
      // where twenty different Discord members spoke in turn would collapse into
      // one group under one name. `authorGroupingKey` namespaces a Signet uuid
      // apart from a source-system id.
      //
      // A tombstone draws no author line, so a row after one never groups
      // under it: its header is what says whose message it is.
      const sameAuthor =
        !!prev &&
        prevRow.visibility === "visible" &&
        authorGroupingKey(prev) === authorGroupingKey(message) &&
        !prev.is_deleted;
      const within =
        !!prev &&
        new Date(message.created_at).getTime() -
          new Date(prev.created_at).getTime() <
          GROUPING_GAP_MS;
      const startsDay =
        !prev || dayKey(prev.created_at) !== dayKey(message.created_at);
      return {
        message,
        visibility,
        // A new day always restarts the chrome: a grouped follow-on under a
        // divider would inherit the previous day's author line.
        showHeader: startsDay || !(sameAuthor && within),
        startsDay,
      };
    });
  }, [thread.rows]);

  const rowKeys = useMemo(
    () =>
      decorated.map(
        (entry) => entry.message.client_message_id ?? entry.message.id,
      ),
    [decorated],
  );
  const { firstItemIndex, prepended } = usePrependAwareFirstIndex(rowKeys);

  /*
    Load the next older page while the member sits at the top of what is
    loaded. Tracked as a state rather than answered from `startReached`, which
    fires once per arrival at the top: a page whose rows are all held by the
    block list draws nothing, the member is still at the top, and a one-shot
    callback would never ask again. A failure stops the loop; the header's
    Retry resumes it.

    Armed only once the list has left its top in this channel. Virtuoso
    renders from the top before it scrolls to `initialTopMostItemIndex`, so it
    reports "at the top" for a moment on every open, and unarmed that spent an
    older-page read on every channel a member opened without scrolling. A
    channel short enough to fit never leaves its top and never arms, which
    costs nothing: a first page that short already said there is nothing
    older (`hasOlder`), and a jump pages through `loadOlder` directly.
  */
  //
  // One page per arrival at the top. Virtuoso reports leaving the top a frame
  // after a prepend moves the rows down, so without this the load settling
  // re-ran the effect while it still read "at the top" and a second page
  // followed the first before the member had scrolled at all. A page that
  // drew nothing (the first row did not change) may ask again.
  const [atTop, setAtTop] = useState(false);
  const [topArrival, setTopArrival] = useState(0);
  const [armedFor, setArmedFor] = useState<string | undefined>(undefined);
  const armed = armedFor === channelId;

  /*
    A switch to a channel already in the cache keeps this list mounted: no
    skeleton, and deliberately no remount, because a fresh Virtuoso's deferred
    scroll to its newest row cancels a jump issued in the same commit. So
    `initialTopMostItemIndex` does not apply, and the list would open wherever
    the previous channel left its scroll offset. This does what a mount would:
    open at the newest row. A jump into this channel is not overridden by it:
    the shell's jump effect runs after this one in the same commit, and a later
    scroll replaces an earlier one; and a jump that settles on a notice leaves
    the list here, at the newest row, rather than at the last channel's offset.

    It arms the older-history load too, but only off the list's top: at the
    top, the scroll above moves it off and that report arms it, while arming
    now would meet the previous channel's "at the top" and read a page for this
    one before the member scrolled at all.

    Only when the same list spans the switch. A switch into a channel that
    shows the skeleton, or out of one that drew no list, mounts a fresh
    Virtuoso, which opens at its end by itself and arms on leaving its top.
    Keyed on the channel it last saw, not on running at all, so Strict Mode's
    second pass over a mount is not taken for a switch.
  */
  const listMounted = useRef(false);
  const seenChannel = useRef(channelId);
  useEffect(() => {
    if (seenChannel.current === channelId) return;
    seenChannel.current = channelId;
    if (!listMounted.current || !virtuoso.current || !channelId) return;
    virtuoso.current.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- arms the channel the list was just switched to, after the imperative scroll above; the list's own at-top report cannot, because it never leaves a top it is not at
    if (!atTop) setArmedFor(channelId);
    // `atTop` is read as of the switch on purpose; a change in it alone is
    // not a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);
  // Declared after the switch effect, so that effect reads whether the list
  // was mounted before this commit.
  useEffect(() => {
    listMounted.current = virtuoso.current !== null;
  });
  const firstRowKey = rowKeys[0];
  const lastTopLoad = useRef<{ arrival: number; firstRowKey?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!armed || !atTop || !hasOlder || isLoadingOlder || olderError) return;
    // Already answered: this arrival's page landed above the row that was
    // first. A first row that is gone instead (a refetch dropped the older
    // pages, the loaded one with them) leaves the member at the top with
    // nothing loaded, so it asks again.
    const last = lastTopLoad.current;
    if (
      last?.arrival === topArrival &&
      last.firstRowKey !== firstRowKey &&
      last.firstRowKey !== undefined &&
      rowKeys.includes(last.firstRowKey)
    ) {
      return;
    }
    lastTopLoad.current = { arrival: topArrival, firstRowKey };
    onLoadOlder?.();
  }, [
    armed,
    atTop,
    topArrival,
    firstRowKey,
    rowKeys,
    hasOlder,
    isLoadingOlder,
    olderError,
    onLoadOlder,
  ]);
  const handleAtTop = (next: boolean) => {
    setAtTop(next);
    if (next) setTopArrival((n) => n + 1);
    else if (channelId) setArmedFor(channelId);
  };

  const headerContext = useMemo<TimelineHeaderContext>(
    () => ({
      olderStatus: isLoadingOlder ? "loading" : olderError ? "error" : "idle",
      onRetryOlder: onLoadOlder,
    }),
    [isLoadingOlder, olderError, onLoadOlder],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToMessage: (messageId: string) => {
        const index = decorated.findIndex(
          (entry) => entry.message.id === messageId,
        );
        // A message older than the loaded window has no index to scroll to.
        // The caller is told, so it can load older history and ask again
        // (#1571) or say it could not, rather than leaving a row that appears
        // to do nothing. The index is into `data`, not offset by
        // `firstItemIndex`: Virtuoso's `scrollToIndex` clamps to
        // `0..totalCount - 1`.
        if (index < 0) return false;
        // Reports what actually happened, not what was attempted: with no
        // attached virtualizer (the error branch renders before `<Virtuoso>`)
        // the optional chain quietly does nothing, and returning `true` there
        // would tell the shell a scroll happened and let it clear the pending
        // target — the same silent failure this boolean exists to end, just one
        // level up.
        if (!virtuoso.current) return false;
        // Instant, not smooth. A smooth scroll is computed once from row
        // heights Virtuoso has only estimated, which is every row after a
        // page lands or a channel's rows swap in, and settled tens of rows
        // short. The instant one re-aims until the list stops changing.
        virtuoso.current.scrollToIndex({
          index,
          align: "center",
          behavior: "auto",
        });
        return true;
      },
    }),
    [decorated],
  );

  /*
    Identity gates the rows exactly as the messages themselves do (#2243).

    `viewerId` decides which of the two shapes `components.md` §11 draws a bubble
    in — self is right-aligned with no avatar, incoming is left with one — and
    `null` is not a third shape to fall back to. It used to be treated as one by
    omission: `MessageItem` computed `!!viewerId && sender_id === viewerId`, so
    an unresolved viewer read as "not mine" and the member's own messages painted
    as a stranger's — the incoming shape, with the first six hex of their own
    uuid standing in for a name, because on this path the roster is still loading
    beside the identity and `resolveAuthorLabel` had already skipped "You". The
    resolve then repainted them, which is worse than it sounds on a virtualized
    list — a self bubble drops its avatar and moves its caption below itself, so
    every row it touched changed height and the thread reflowed under the member.

    So this is not a spinner in front of a correct render; the render is not
    available yet. The skeleton below already stands for "not readable", reserves
    the geometry to the same metrics, and claims no author — which is precisely
    what is true while identity is in flight.
  */
  /*
    Ahead of the skeleton, and that order is load-bearing since #2243 gave the
    branch below a second, slower input.

    An expired session is the likeliest way to reach an unresolved viewer at all,
    and there the same 401 takes out `GET /v1/users/me` and the messages fetch
    together. If identity were allowed to answer first, `viewerUnresolved` would
    hold forever and bury this state — the member would get shimmer over a
    failure that has a retry sitting right here, with no way out but a reload.

    It only covers the *correlated* failure, which is the common one rather than
    the only one: `/v1/users/me` can fail alone (it is the route carrying
    `AuthSyncInterceptor`, so it writes where the chat routes only read), and
    offline it does not answer either. Both leave this branch unreached and the
    skeleton standing. That gap is #2251's, not this branch's — it needs the
    identity query's own error state plumbed in, which no surface here has today.

    The offline half used to be written here as "not attempted at all, since only
    mutations are configured `networkMode: "always"`". The `networkMode` half is
    right and the conclusion is half right (#2249): whether the query *pauses*
    turns on TanStack's `onlineManager`, which starts `#online = true` and moves
    only on the window's `online`/`offline` events — it never reads
    `navigator.onLine`. A link that drops after load pauses it; a document
    restored from bfcache while already offline still believes it is online, so
    the fetch runs and fails. One never settles and one settles to an error with
    no `data`, and only the second is reachable by the retry above.

    What closed the common case is not this branch. A viewer id cached beside the
    first chunk (#2249, `lib/chat/viewer-id.tsx`) resolves identity from disk in
    both, so the gate opens on the rows the member already has instead of waiting
    on a request that is not coming.

    A load error and a pending load are mutually exclusive for this query anyway
    (`use-chat-channel.ts` reports `isLoading` as `query.isPending`, which is
    false once a query has settled either way), so putting the failure first
    costs the loading case nothing.
  */
  if (loadError) {
    return (
      <ErrorState
        title="Couldn't load messages"
        // The canonical string from `writing.md` §7, not `loadError.message`.
        // A raw fetch rejection ("Failed to fetch") is not copy, and the doc
        // that owns this table already answers the question a member has.
        description="Confirm your chapter access and retry."
        onRetry={onRetryLoad}
      />
    );
  }

  if (isLoading || viewerUnresolved) {
    return (
      <>
        {/*
          The `LoadingState` this branch used to render carried `role="status"`,
          `aria-busy` and a visible "Loading messages…" caption, so a screen
          reader was told. `MessageTimelineSkeleton` is `aria-hidden` — ten
          anonymous rectangles are no use read aloud — which would have left this
          window silent, and it is not a rare window: `use-chat-channel` keys its
          query per channel, so every first visit to a channel passes through it.

          Its own region rather than a shared one, because the shell's announcer
          one column over says "Loading channels", which is a different event.
          The two never overlap — `chat-shell.tsx` mounts this timeline only once
          `channelsPaneState` is `"ready"`, and renders its own skeleton in the
          states before that — so there is no window in which both speak.

          Not `aria-atomic`: this region holds one short string and nothing
          re-renders inside it, so the default suffices, and the reasoning
          `chat-shell.tsx` records against `aria-atomic` on a repainting list
          applies here too.
        */}
        <div role="status" aria-live="polite" className="sr-only">
          Loading messages
        </div>
        <MessageTimelineSkeleton />
      </>
    );
  }
  if (thread.rows.length === 0) {
    // Counted after the block list, held rows included: a channel whose only
    // messages are being held is not an empty channel, and saying "Nothing in
    // this channel yet" over them would be false. `BlockListNotice` above the
    // timeline says they are held.
    if (thread.heldCount > 0) return <div className="h-full" />;
    return (
      <EmptyState
        title="Nothing in this channel yet"
        description="Be the first to post — everyone in the channel sees it right away."
      />
    );
  }

  return (
    <ImageViewerProvider value={imageViewer.open}>
      <div className="h-full">
        <Virtuoso
          ref={virtuoso}
          data={decorated}
          firstItemIndex={firstItemIndex}
          // Until the list is armed it is still settling onto its bottom, and
          // the live page landing over the cached tail prepends rows; following
          // those is what keeps a cold open at the newest message.
          followOutput={holdFollow || (prepended && armed) ? false : "smooth"}
          initialTopMostItemIndex={Math.max(decorated.length - 1, 0)}
          atTopStateChange={handleAtTop}
          context={headerContext}
          components={{
            List: TimelineList,
            Scroller: TimelineScroller,
            Header: TimelineHeader,
          }}
          itemContent={(_, entry) => (
            <>
              {entry.startsDay ? (
                // components.md §11: "Day divider: centered caption 12.5px / 600".
                <p className="py-3 text-center text-[12.5px] font-semibold text-muted-foreground">
                  {dayLabel(entry.message.created_at)}
                </p>
              ) : null}
              {entry.visibility === "tombstone" ? (
                <BlockedMessageTombstone
                  senderName={
                    entry.message.sender_id
                      ? nameFor(entry.message.sender_id)
                      : null
                  }
                  canUnblock={tombstoneCanUnblock(entry.message, blockState)}
                  onUnblock={() => {
                    if (entry.message.sender_id) {
                      onUnblock(entry.message.sender_id);
                    }
                  }}
                  reload={
                    entry.message.sender_id
                      ? (maskedRefresh.get(entry.message.sender_id) ?? null)
                      : null
                  }
                  onReload={() => {
                    if (entry.message.sender_id) {
                      onReloadMasked(entry.message.sender_id);
                    }
                  }}
                  showHeader={entry.showHeader}
                />
              ) : (
                <MessageItem
                  nameFor={nameFor}
                  message={entry.message}
                  blockState={blockState}
                  avatarUrl={importedAvatarUrl(entry.message, avatars.data)}
                  viewerId={viewerId}
                  showHeader={entry.showHeader}
                  onReact={onReact}
                  onUnreact={onUnreact}
                  onReply={onReply}
                  onJumpToParent={onJumpToParent}
                  // The parent, or `null` when it is outside the loaded window.
                  // `MessageItem` decides whether to draw a quote from
                  // `message.reply_to_id`, not from this prop, so `null` and
                  // `undefined` are equivalent to it — the `?? null` is here to say
                  // "looked up and absent" rather than to drive a branch.
                  replyParent={
                    entry.message.reply_to_id
                      ? (byId.get(entry.message.reply_to_id) ?? null)
                      : undefined
                  }
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                  onRetryUnconfirmed={onRetryUnconfirmed}
                  onAct={onAct}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  isBookmarked={bookmarkedMessageIds?.has(entry.message.id)}
                  onToggleBookmark={onToggleBookmark}
                  canManageChannel={canManageChannel}
                  isTapRevealed={tapRevealed.isRevealed(entry.message)}
                  onToggleTapReveal={() => tapRevealed.toggle(entry.message)}
                />
              )}
            </>
          )}
          computeItemKey={(_, entry) =>
            entry.message.client_message_id ?? entry.message.id
          }
        />
      </div>
      <ImageViewer viewer={imageViewer} />
    </ImageViewerProvider>
  );
});
