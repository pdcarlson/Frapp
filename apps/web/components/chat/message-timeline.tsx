"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  EmptyState,
  ErrorState,
  Skeleton,
} from "@/components/shared/async-states";
import { useTapRevealedMessage } from "@/hooks/use-tap-revealed-message";
import { cn } from "@/lib/utils";
import { COLD_LOAD_MARKS, markColdLoad } from "@/lib/chat/cold-load-marks";
import { MessageItem } from "./message-item";
import type { ChatMessage, ReplayRequest } from "@repo/chat-core/types";
import { authorGroupingKey, useAuthorAvatars } from "@repo/hooks";

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
          <div className="flex min-w-0 max-w-[86%] flex-1 flex-col items-start gap-1.5">
            {showHeader ? <Skeleton className="ml-1 h-[13px] w-24" /> : null}
            <Skeleton className={cn("h-[13px]", width)} />
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

/** Local calendar day, so "yesterday" breaks where the reader's day breaks. */
function dayKey(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
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
   * It still no-ops for a message outside the loaded window — but it now says
   * so, because callers cannot otherwise tell "scrolled" from "did nothing".
   * Pins could ignore that (a pin you can see is by definition loaded); search
   * cannot, since its whole purpose is reaching messages beyond the window, and
   * a silent `void` made every such hit an inert row.
   */
  scrollToMessage: (messageId: string) => boolean;
}

export interface MessageTimelineProps {
  /** Undefined while no channel is selected — avatar resolution just no-ops. */
  channelId: string | undefined;
  messages: ChatMessage[];
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
  */
  const readable = !isLoading && !loadError;
  useEffect(() => {
    if (readable) markColdLoad(COLD_LOAD_MARKS.channelReadable);
  }, [readable]);

  // One batched request for every distinct imported-author avatar visible in
  // this window, rather than one per message (#1231). A miss (no avatar, out
  // of chapter, or unsigned) just means that row keeps its initials fallback.
  const avatars = useAuthorAvatars(channelId, messages);

  // Which row's action cluster a tap revealed — one id for the whole list, so
  // tapping a second row dismisses the first's, matching the reference
  // affordance (#1193). Same key basis as `computeItemKey` below.
  const tapRevealed = useTapRevealedMessage();

  // Parent lookup for reply quotes (#489), built once per message list rather
  // than scanned per row: the timeline is virtualized but `decorated` is mapped
  // over the whole window, so a `find` inside it would be O(n²) on a long
  // channel. Only messages that are actually replied to occupy the map.
  const byId = useMemo(() => {
    const index = new Map<string, ChatMessage>();
    for (const message of messages) index.set(message.id, message);
    return index;
  }, [messages]);

  // Precompute "showHeader" so we don't recompute per render in the renderer.
  const decorated = useMemo(() => {
    return messages.map((message, index) => {
      const prev = messages[index - 1];
      // Keyed, not compared on `sender_id` directly: that column is nullable
      // now, and `null === null` is true in JS — so an imported archive channel
      // where twenty different Discord members spoke in turn would collapse into
      // one group under one name. `authorGroupingKey` namespaces a Signet uuid
      // apart from a source-system id.
      const sameAuthor =
        !!prev &&
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
        // A new day always restarts the chrome: a grouped follow-on under a
        // divider would inherit the previous day's author line.
        showHeader: startsDay || !(sameAuthor && within),
        startsDay,
      };
    });
  }, [messages]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToMessage: (messageId: string) => {
        const index = decorated.findIndex(
          (entry) => entry.message.id === messageId,
        );
        // A message older than the loaded window has no index to scroll to.
        // Not scrolling is still the honest outcome — backfilling to reach it
        // is its own piece of work (#1571) — but the caller is now told, so it
        // can say so rather than leaving a row that appears to do nothing.
        if (index < 0) return false;
        // Reports what actually happened, not what was attempted: with no
        // attached virtualizer (the error branch renders before `<Virtuoso>`)
        // the optional chain quietly does nothing, and returning `true` there
        // would tell the shell a scroll happened and let it clear the pending
        // target — the same silent failure this boolean exists to end, just one
        // level up.
        if (!virtuoso.current) return false;
        virtuoso.current.scrollToIndex({
          index,
          align: "center",
          behavior: "smooth",
        });
        return true;
      },
    }),
    [decorated],
  );

  if (isLoading) {
    return <MessageTimelineSkeleton />;
  }
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
  if (messages.length === 0) {
    return (
      <EmptyState
        title="Nothing in this channel yet"
        description="Be the first to post — everyone in the channel sees it right away."
      />
    );
  }

  return (
    <div className="h-full">
      <Virtuoso
        ref={virtuoso}
        data={decorated}
        followOutput="smooth"
        initialTopMostItemIndex={Math.max(decorated.length - 1, 0)}
        components={{ List: TimelineList, Scroller: TimelineScroller }}
        itemContent={(_, entry) => (
          <>
            {entry.startsDay ? (
              // components.md §11: "Day divider: centered caption 12.5px / 600".
              <p className="py-3 text-center text-[12.5px] font-semibold text-muted-foreground">
                {dayLabel(entry.message.created_at)}
              </p>
            ) : null}
            <MessageItem
              nameFor={nameFor}
              message={entry.message}
              avatarUrl={
                entry.message.author_avatar_path
                  ? avatars.data?.[entry.message.author_avatar_path]
                  : undefined
              }
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
          </>
        )}
        computeItemKey={(_, entry) =>
          entry.message.client_message_id ?? entry.message.id
        }
      />
    </div>
  );
});
