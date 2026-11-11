"use client";

import type { ChatMessageFlag } from "@repo/validation";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Virtuoso, type ListRange, type VirtuosoHandle } from "react-virtuoso";
import { ErrorState, Skeleton } from "@/components/shared/async-states";
import { Button } from "@/components/ui/button";
import { useTapRevealedMessage } from "@/lib/hooks/use-tap-revealed-message";
import { cn } from "@/lib/utils";
import { useChatDensity } from "@/lib/chat/chat-density";
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
  type ThreadRow,
} from "@repo/chat-core/blocks";
import type { ChatMessage, ReplayRequest } from "@repo/chat-core/types";
import type { MemberLookup } from "@repo/chat-core/message-actions";
import type { ThreadBlockList } from "@/lib/chat/use-thread-block-list";
import { resolveAuthorAvatar, useAuthorAvatars } from "@repo/hooks";
import { dayDividerLabel, decorateThread } from "@repo/chat-core/grouping";

/**
 * Widths cycled rather than randomised, for the reason `channel-list.tsx`
 * records one column over: a skeleton that reshuffles on every render flickers,
 * and under Strict Mode it would differ between the two passes.
 *
 * The `false` entries are follow-on rows in a run, which is what a real
 * channel mostly is. They carry no avatar and no author line, so the pattern
 * reserves the gutter without drawing into it.
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
 * - **Same box metrics as `MessageItem`, in the member's density.** Cozy:
 *   `px-5`, `pb-0.5`, `pt-4` on a row that starts a run and `pt-0.5` on a
 *   follow-on, a `w-8` avatar gutter and a `gap-3` beside it, a 20px author
 *   line and a 25px body line. Compact: `pt-1`, a `w-14` time gutter and
 *   `gap-2`, and the body line only. Copied deliberately: a placeholder whose
 *   padding is "close enough" moves the first real row by the difference.
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
export function MessageTimelineSkeleton({
  channelId,
}: { channelId?: string | null } = {}) {
  // Compact rows (§11 § Density) have no avatar or author line: a 56px time
  // gutter, the name leading a 25px body line, and runs 4 apart.
  // The channel's display on this browser, when it has one pinned (#3787).
  const compact = useChatDensity(channelId) === "compact";
  return (
    <div
      aria-hidden="true"
      className="flex h-full flex-col justify-end overflow-hidden"
    >
      {SKELETON_ROWS.map(([startsRun, width], index) => (
        <div
          key={index}
          // The row metrics `MessageItem` draws, restated so the swap is a
          // repaint and not a reflow.
          className={cn(
            "flex px-5 pb-0.5",
            compact ? "gap-2" : "gap-3",
            startsRun ? (compact ? "pt-1" : "pt-4") : "pt-0.5",
          )}
        >
          <div className={cn("shrink-0", compact ? "w-14" : "w-8")}>
            {startsRun ? (
              compact ? (
                <div className="flex h-[25px] items-center justify-end">
                  <Skeleton className="h-[13px] w-12" />
                </div>
              ) : (
                <Skeleton className="h-8 w-8 rounded-full" />
              )
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {startsRun && !compact ? (
              // `message-item.tsx`'s author line: a 20px line box.
              <div className="flex h-5 items-center">
                <Skeleton className="h-[13px] w-24" />
              </div>
            ) : null}
            {/* One 25px body line, the `body` role's line box. */}
            <div className="flex h-[25px] items-center">
              <Skeleton className={cn("h-4", width)} />
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

/**
 * How close to the end the list has to sit to count as on its newest row. A
 * few pixels of slack, so a trackpad that settles a hair short of the end still
 * reads as "at the bottom". Also Virtuoso's `atBottomThreshold`, so this hook
 * and `followOutput` agree on where the bottom is: with Virtuoso's default 4px,
 * a member 10px short saw a new message not followed, then snapped to by the
 * next row that grew.
 */
const STICK_TO_BOTTOM_SLACK_PX = 16;

/**
 * Keeps the list on its newest row while rows grow, for as long as the member
 * has left it there (#3863).
 *
 * Virtuoso follows a new row (`followOutput`), and re-pins on growth only in
 * a short window it opens itself: about 100ms after its props settle or after
 * `autoscrollToBottom()`. Growth after that is not followed. A photo grows
 * after that, twice: its attachments read (one per message, fired when the row
 * first draws) swaps "Loading attachment…" for the picture, and a photo with no
 * stored size (anything imported from Discord, or sent before 2026-11-07)
 * grows again when its bytes arrive. Each growth pushed the newest messages
 * below the fold, so opening a channel landed a few messages up. Reproduced
 * against the real list in a browser, for sized and unsized photos alike.
 *
 * "Left it there" is read from scroll events. Growth below the scroll
 * position changes `scrollHeight` without firing one, so the last scroll still
 * says where the member meant to be. Scrolling up, or a jump to an older
 * message, fires one that clears it. A fresh scroller (a list mounted after the
 * skeleton, or after an empty channel) opens on its newest row, and so does a
 * channel switch (`pinned`), even when neither moves the list far enough to
 * fire one.
 *
 * A change in the row count is left to `followOutput`, which animates a new
 * arrival in. Virtuoso reports that height change from its own layout effect,
 * as it takes the new rows, so the count it is compared with is published in an
 * insertion effect, which runs before every layout effect in the commit. A
 * passive effect ran after it, so an arrival read as growth and was snapped
 * to, and the row's next growth read as the arrival and was missed.
 */
function useStickToBottom({
  virtuoso,
  rowCount,
  hold,
}: {
  virtuoso: React.RefObject<VirtuosoHandle | null>;
  rowCount: number;
  hold: boolean;
}): {
  scrollerRef: (element: HTMLElement | Window | null) => void;
  totalListHeightChanged: () => void;
  /** Marks the list as on its newest row, for a scroll made there in code. */
  pinned: () => void;
} {
  const stuck = useRef(true);
  const countAtLastHeight = useRef(rowCount);
  const latest = useRef({ rowCount, hold });
  useInsertionEffect(() => {
    latest.current = { rowCount, hold };
  });
  const detach = useRef<(() => void) | null>(null);

  const scrollerRef = useCallback((element: HTMLElement | Window | null) => {
    detach.current?.();
    detach.current = null;
    if (!(element instanceof HTMLElement)) return;
    stuck.current = true;
    const onScroll = () => {
      stuck.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <=
        STICK_TO_BOTTOM_SLACK_PX;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    detach.current = () => element.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => () => detach.current?.(), []);

  const totalListHeightChanged = useCallback(() => {
    const { rowCount: count, hold: held } = latest.current;
    const added = count !== countAtLastHeight.current;
    countAtLastHeight.current = count;
    if (added || held || !stuck.current || !virtuoso.current) return;
    virtuoso.current.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  }, [virtuoso]);

  const pinned = useCallback(() => {
    stuck.current = true;
  }, []);

  return { scrollerRef, totalListHeightChanged, pinned };
}

/** What the row above the oldest loaded message says, if anything. */
interface TimelineHeaderContext {
  olderStatus: "idle" | "loading" | "error";
  onRetryOlder?: () => void;
  /**
   * The channel start, once nothing older is left to load: the oldest loaded
   * message is the channel's first, so the history begins with it.
   */
  start?: React.ReactNode;
  /**
   * Drawn first, whatever the older-history state: a thread's parent, which
   * heads the list from the first frame (#4034), unlike a channel's start.
   */
  header?: React.ReactNode;
}

/**
 * The row above the oldest loaded message: the older-history read in flight,
 * or its failure with a Retry. Otherwise the channel start, once no older page
 * is left (`context.start` is unset while one is), and nothing before that.
 * The oldest loaded row starts a day and its divider renders in the same item,
 * which keeps the first row's action bar (centred on the row's top edge)
 * inside the scroller. (A row whose timestamp cannot be read gets no divider,
 * so there the bar clips.)
 */
function TimelineHeader({ context }: { context?: TimelineHeaderContext }) {
  if (context?.header) {
    return (
      <>
        {context.header}
        <OlderHistoryRow context={{ ...context, header: undefined }} />
      </>
    );
  }
  return <OlderHistoryRow context={context} />;
}

function OlderHistoryRow({ context }: { context?: TimelineHeaderContext }) {
  if (context?.olderStatus === "loading") {
    return (
      <p
        role="status"
        className="py-3 text-center text-caption text-muted-foreground"
      >
        Loading earlier messages...
      </p>
    );
  }
  if (context?.olderStatus === "error") {
    return (
      <div className="flex items-center justify-center gap-2 py-3">
        <p role="alert" className="text-caption text-muted-foreground">
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
  return context?.start ?? null;
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
  /**
   * Resolves `users.id` → the member's signed photo URL; `null` for initials.
   * From the same roster read as `nameFor` (#732).
   */
  avatarFor: (userId: string) => string | null;
  /**
   * Resolves `users.id` → the member's role color, or `null` (#3485). Same
   * roster read again. Optional so a caller without a roster paints plain names.
   */
  roleColorFor?: (userId: string) => string | null;
  /**
   * Replies new to the viewer in each thread they follow here, by root id,
   * for each thread card (#4297; `useThreadUnread`).
   */
  threadUnread?: Readonly<Record<string, number>>;
  isLoading: boolean;
  loadError: Error | null;
  onRetryLoad?: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  /** Stages an inline reply in the composer — the row's Reply control (#489). */
  onReply?: (message: ChatMessage) => void;
  /** Opens a message's thread (#3785): Start thread, and the parent's chip. */
  onOpenThread?: (message: ChatMessage) => void;
  /**
   * The ids of the messages drawn in the viewport, each time that set changes
   * (#4186): what the Important strip counts as scrolled past. A blocked
   * member's tombstone is left out, since its words aren't on screen.
   */
  onVisibleMessagesChange?: (messageIds: string[]) => void;
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
  /** A poll card's Close poll, on the viewer's own open poll (#3794). */
  onClosePoll?: (messageId: string) => void;
  /** Flag, re-flag or (`null`) unflag a message (#3921). */
  onFlag?: (messageId: string, flag: ChatMessageFlag | null) => void;
  /**
   * Message ids the viewer has bookmarked (#462). A set rather than a
   * per-message flag so the virtualized list looks each row up in O(1) without
   * the caller rebuilding an array of props per render.
   */
  bookmarkedMessageIds?: Set<string>;
  onToggleBookmark?: (messageId: string, next: boolean) => void;
  canManageChannel?: boolean;
  /** A row's Report and Block (#2687); see `MessageItemProps`. */
  onReport?: (message: ChatMessage) => void;
  onBlock?: (message: ChatMessage) => void;
  /** Opens a member's profile by `users.id` (#3726); see `MessageItemProps`. */
  onOpenProfile?: (userId: string) => void;
  isMember?: MemberLookup;
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
  /**
   * The start of this channel's history (`channel-start.tsx`). It stands in
   * the timeline's place while the channel has no messages, just above the
   * composer where the first one will land, and above the oldest message once
   * `hasOlder` says there is nothing earlier.
   */
  channelStart?: React.ReactNode;
  /**
   * Heads the list from the first frame, above the older-history row and the
   * channel start, and above an empty list's start too: a thread's parent
   * (#4034), which must not wait for every older reply to load.
   */
  header?: React.ReactNode;
  /**
   * The list's tap-reveal state (`useTapRevealedMessage`), when a row outside
   * the list shares it: the thread panel's parent in `header`, so tapping it
   * and then a reply leaves one action bar open, not two (#4034). Omitted, the
   * timeline keeps its own.
   */
  tapRevealed?: ReturnType<typeof useTapRevealedMessage>;
}

/**
 * Virtualized message timeline in the compact layout (`components.md` §11,
 * owner decision 2026-09-29, #2873). Rows group into runs and day dividers by
 * `@repo/chat-core/grouping`, the rules mobile shares, so a run and a divider
 * start in the same places on both surfaces. Empty / loading / error all render
 * explicit states — never a blank pane.
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
    avatarFor,
    roleColorFor,
    threadUnread,
    isLoading,
    loadError,
    onRetryLoad,
    onReact,
    onUnreact,
    onReply,
    onOpenThread,
    onVisibleMessagesChange,
    onJumpToParent,
    onRetry,
    onDiscard,
    onRetryUnconfirmed,
    onAct,
    onEdit,
    onDelete,
    onClosePoll,
    onFlag,
    bookmarkedMessageIds,
    onToggleBookmark,
    canManageChannel,
    onReport,
    onBlock,
    onOpenProfile,
    isMember,
    hasOlder = false,
    isLoadingOlder = false,
    olderError = false,
    onLoadOlder,
    holdFollow = false,
    channelStart,
    header,
    tapRevealed: sharedTapRevealed,
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
  const ownTapRevealed = useTapRevealedMessage();
  const tapRevealed = sharedTapRevealed ?? ownTapRevealed;

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

  // Where each run and each day starts. Over the rows the list lets through: a
  // held row is not drawn, so it neither breaks nor joins a run. A tombstone is
  // drawn and names no author, so the row after one always starts a run.
  const decorated = useMemo(() => {
    const rows = decorateThread(thread.rows);
    const out: {
      message: ChatMessage;
      visibility: ThreadRow["visibility"];
      showHeader: boolean;
      endsRun: boolean;
      startsDay: boolean;
      runStartedAt: string;
    }[] = [];
    for (let index = 0; index < rows.length; index++) {
      const { row, startsDay, startsRun, endsRun } = rows[index]!;
      out.push({
        message: row.message,
        visibility: row.visibility,
        showHeader: startsRun,
        endsRun,
        startsDay,
        // The run's first message, whose author line a follow-on's gutter time
        // is read against (it keeps AM/PM once the run has crossed noon).
        runStartedAt: startsRun
          ? row.message.created_at
          : (out[index - 1]?.runStartedAt ?? row.message.created_at),
      });
    }
    return out;
  }, [thread.rows]);

  const rowKeys = useMemo(
    () =>
      decorated.map(
        (entry) => entry.message.client_message_id ?? entry.message.id,
      ),
    [decorated],
  );
  const { firstItemIndex, prepended } = usePrependAwareFirstIndex(rowKeys);
  const stickToBottom = useStickToBottom({
    virtuoso,
    rowCount: decorated.length,
    hold: holdFollow,
  });

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
    // The scroll above may not move the list (the new channel ends where the
    // last one did), and then no scroll event says it is on its newest row.
    stickToBottom.pinned();
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
      start: hasOlder ? undefined : channelStart,
      header,
    }),
    [isLoadingOlder, olderError, onLoadOlder, hasOlder, channelStart, header],
  );

  // Virtuoso reports a range in its own index space, which `firstItemIndex`
  // offsets; `decorated` is indexed from 0.
  const visibleRange = useRef<ListRange | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  // `useStickToBottom`'s callback is stable, and must stay so: Virtuoso calls
  // a new `scrollerRef` again, which would re-pin the list to its bottom.
  const stickScrollerRef = stickToBottom.scrollerRef;
  const scrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      scroller.current = element instanceof HTMLElement ? element : null;
      stickScrollerRef(element);
    },
    [stickScrollerRef],
  );
  const reportVisible = useCallback(() => {
    const range = visibleRange.current;
    if (!onVisibleMessagesChange || !range) return;
    const view = scroller.current?.getBoundingClientRect();
    const ids: string[] = [];
    for (let i = range.startIndex; i <= range.endIndex; i++) {
      const entry = decorated[i - firstItemIndex];
      if (!entry || entry.visibility === "tombstone") continue;
      // Virtuoso's range includes a row with one pixel showing. A row
      // counts once half of it is on screen (or it fills half the screen),
      // as mobile's viewability threshold does.
      const row = view
        ? scroller.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)
        : null;
      if (view && row) {
        const box = row.getBoundingClientRect();
        const shown =
          Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top);
        if (box.height > 0 && shown < Math.min(box.height, view.height) / 2) {
          continue;
        }
      }
      ids.push(entry.message.id);
    }
    onVisibleMessagesChange(ids);
  }, [decorated, firstItemIndex, onVisibleMessagesChange]);
  const handleRangeChanged = useCallback(
    (range: ListRange) => {
      visibleRange.current = range;
      reportVisible();
    },
    [reportVisible],
  );
  // A channel switch keeps this component and its index space, so the last
  // channel's range would map onto the new channel's rows: forget it until
  // Virtuoso reports the new one.
  const rangeChannel = useRef(channelId);
  // The rows under an unchanged range can change too: a page landing, or a
  // row leaving the hold.
  useEffect(() => {
    if (rangeChannel.current !== channelId) {
      rangeChannel.current = channelId;
      visibleRange.current = null;
    }
    reportVisible();
  }, [reportVisible, channelId]);

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

    `viewerId` decides whose message a row is — whether its author line says
    "You" in the chapter accent, and whether it offers Edit and Delete — and
    `null` is not a third answer to fall back to. It used to be treated as one by
    omission: `MessageItem` computed `!!viewerId && sender_id === viewerId`, so
    an unresolved viewer read as "not mine" and the member's own messages painted
    as a stranger's, with the first six hex of their own uuid standing in for a
    name, because on this path the roster is still loading beside the identity
    and `resolveAuthorLabel` had already skipped "You". The resolve then
    repainted them. (Under the §11 bubble layout that repaint also moved every
    self row to the other side and changed its height, so the thread reflowed
    under the member; the compact layout keeps the geometry, but the rows would
    still claim the wrong author for a moment.)

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
        // Picked by the failure's status (`writing.md` §7), not
        // `loadError.message`: a raw fetch rejection is not copy.
        description={describeLoadFailure(loadError)}
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
        <MessageTimelineSkeleton channelId={channelId} />
      </>
    );
  }
  if (thread.rows.length === 0) {
    // Counted after the block list, held rows included: a channel whose only
    // messages are being held is not an empty channel, so it gets no channel
    // start either. `BlockListNotice` above the timeline says they are held.
    if (thread.heldCount > 0) return <div className="h-full">{header}</div>;
    // Not an empty-state card: the channel's start, at the bottom where its
    // first message will land (`writing.md` § Chat (dashboard), Channel start).
    // The box scrolls and the inner column is at least its height, so a start
    // taller than a short window is scrolled to, not clipped at the top.
    return (
      <div className="h-full overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end">
          {header}
          {channelStart}
        </div>
      </div>
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
          rangeChanged={handleRangeChanged}
          // Holds the open on its newest row while rows above it grow: a photo
          // loading after the list settled (#3863).
          scrollerRef={scrollerRef}
          atBottomThreshold={STICK_TO_BOTTOM_SLACK_PX}
          totalListHeightChanged={stickToBottom.totalListHeightChanged}
          context={headerContext}
          components={{
            List: TimelineList,
            Scroller: TimelineScroller,
            Header: TimelineHeader,
          }}
          itemContent={(_, entry) => (
            <>
              {entry.startsDay ? (
                // components.md §11 § Grouping: a hairline either side of a
                // centred 12.5 / 600 caption, and the only date in the thread.
                <div
                  data-slot="day-divider"
                  className="flex items-center gap-3 px-5 pb-1 pt-4 text-caption font-semibold text-muted-foreground"
                >
                  <span aria-hidden="true" className="h-px flex-1 bg-border" />
                  <span>{dayDividerLabel(entry.message.created_at)}</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              {entry.visibility === "tombstone" ? (
                <BlockedMessageTombstone
                  channelId={entry.message.channel_id}
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
                  authorColor={
                    entry.message.sender_id
                      ? roleColorFor?.(entry.message.sender_id)
                      : null
                  }
                  blockState={blockState}
                  avatarUrl={
                    resolveAuthorAvatar(
                      entry.message,
                      avatarFor,
                      avatars.data,
                    ) ?? undefined
                  }
                  viewerId={viewerId}
                  showHeader={entry.showHeader}
                  endsRun={entry.endsRun}
                  runStartedAt={entry.runStartedAt}
                  onReact={onReact}
                  onUnreact={onUnreact}
                  onReply={onReply}
                  onOpenThread={onOpenThread}
                  avatarFor={avatarFor}
                  roleColorFor={roleColorFor}
                  threadUnread={threadUnread?.[entry.message.id] ?? 0}
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
                  onClosePoll={onClosePoll}
                  onFlag={onFlag}
                  isBookmarked={bookmarkedMessageIds?.has(entry.message.id)}
                  onToggleBookmark={onToggleBookmark}
                  canManageChannel={canManageChannel}
                  onReport={onReport}
                  onBlock={onBlock}
                  onOpenProfile={onOpenProfile}
                  isMember={isMember}
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
