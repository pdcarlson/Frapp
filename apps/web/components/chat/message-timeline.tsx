"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { useTapRevealedMessage } from "@/hooks/use-tap-revealed-message";
import { MessageItem } from "./message-item";
import type { ChatMessage } from "@repo/chat-core/types";
import { authorGroupingKey, useAuthorAvatars } from "@repo/hooks";

const GROUPING_GAP_MS = 5 * 60 * 1000;

/**
 * Virtuoso owns the scroller's DOM and types both wrappers as `div`, so the
 * list semantics are carried by ARIA rather than by `<ul>`/`<li>`. That is why
 * `MessageItem` renders `role="listitem"` on a `div` instead of an `<li>`: a
 * real `<li>` inside Virtuoso's `div` was an orphan list item on this surface,
 * while the same component sat inside a genuine `<ul>` in the thread panel —
 * two call sites disagreeing about the row's own element.
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
  onOpenThread?: (message: ChatMessage) => void;
  onRetry?: (clientMessageId: string) => void;
  onDiscard?: (clientMessageId: string) => void;
  onAct?: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => void;
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
    onOpenThread,
    onRetry,
    onDiscard,
    onAct,
    onEdit,
    onDelete,
    canManageChannel,
  },
  ref,
) {
  const virtuoso = useRef<VirtuosoHandle | null>(null);

  // One batched request for every distinct imported-author avatar visible in
  // this window, rather than one per message (#1231). A miss (no avatar, out
  // of chapter, or unsigned) just means that row keeps its initials fallback.
  const avatars = useAuthorAvatars(channelId, messages);

  // Which row's action cluster a tap revealed — one id for the whole list, so
  // tapping a second row dismisses the first's, matching the reference
  // affordance (#1193). Same key basis as `computeItemKey` below.
  const tapRevealed = useTapRevealedMessage();

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
    return <LoadingState message="Loading messages…" />;
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
        components={{ List: TimelineList }}
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
              onOpenThread={onOpenThread}
              onRetry={onRetry}
              onDiscard={onDiscard}
              onAct={onAct}
              onEdit={onEdit}
              onDelete={onDelete}
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
