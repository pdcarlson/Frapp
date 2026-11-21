import { forwardRef, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  activityChannelLinks,
  resolveAuthorLabel,
  useActivity,
  useActivityFaces,
  useActivityUnread,
  useBookmarks,
  useNowDate,
  usePinnedMessages,
  type ActivityRow,
  type NameResolver,
} from "@repo/hooks";
import { replyPreviewText } from "@repo/chat-core/reply-preview";
import { forwardedFromOf } from "@repo/chat-core/types";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { sentAtLabel } from "./message-actions-sheet";
import {
  ActivityFaces,
  ActivityListRow,
  ActivityRowSkeleton,
} from "@/components/activity/activity-row";
import {
  ErrorState,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useGuardedSheetRef,
  useSheetClose,
  useTallSheetProps,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";

/**
 * The thread header's lists (#3723), the phone's face of web's Pinned, Saved
 * and Links panels (`apps/web/components/chat/channel-menu.tsx`):
 *
 * - **Pinned** is this channel's pins, newest pin first, from
 *   `GET /v1/channels/{id}/pins`. The server's list, not the loaded window's
 *   `is_pinned` rows: a pin from last semester is exactly what this list is
 *   for, and the window rarely holds it. A blocked member's pin comes back
 *   masked (`sender_blocked`) and reads as the thread's tombstone does.
 * - **Saved** is the viewer's own bookmarks across the chapter, newest save
 *   first, from `GET /v1/bookmarks`. A row whose channel the viewer can no
 *   longer read (`message_available: false`) is inert, as web's is: opening it
 *   would land on a channel the list does not hold. Each row has Remove, since
 *   a deleted message's bookmark has no long-press to unsave it from.
 * - **Links** is the sign-up links posted in this channel (#5779), from
 *   Activity's own read (`activityChannelLinks`), where Discord keeps a
 *   channel's links beside its pins. Activity listed every channel's until
 *   Paul's direction A moved them here (`spec/behavior/activity.md` § Links).
 *   A row opens the link's sheet over this list (`onOpenLink`), with Open
 *   link, Done, Hide, Open in chat and, for `channels:manage`, Remove for
 *   everyone, as Activity's row did; opening it clears its dot.
 *
 * A row opens its message in the channel, or in its thread when it is a
 * reply (`onOpen`), which closes the sheet:
 * the jump is the confirmation. Discord's Pinned Messages and Slack's Saved
 * items both work this way.
 *
 * The reads live in {@link PinnedRows} and {@link SavedRows}, children of the
 * modal, because gorhom mounts a modal's children only while it is presented:
 * the pins are not fetched until the list is opened. The Saved read is
 * usually warm already, since the thread reads the same query
 * (`useBookmarkedMessageIds`) for the Save row's label.
 */
export type MessageListKind = "pinned" | "saved" | "links";

type LinkRow = Extract<ActivityRow, { kind: "link" }>;

export const PINNED_TITLE = "Pinned messages";
export const SAVED_TITLE = "Saved messages";
/** Web's view title for the same list (`channel-menu.tsx`). */
export const LINKS_TITLE = "Links";
export const PINNED_EMPTY =
  "No pinned messages yet. Officers pin what everyone should be able to find.";
export const SAVED_EMPTY =
  "Nothing saved yet. Long-press a message and choose Save message to keep it here.";
/** An empty channel's Links: web's words (`channel-links-panel.tsx`). */
export const LINKS_EMPTY = "Nothing to sign up for in this channel.";
/** What an inert Saved row says in place of its author. */
export const SAVED_UNAVAILABLE = "Unavailable";

export interface MessageListSheetProps {
  kind: MessageListKind;
  channelId: string | null;
  nameFor: NameResolver;
  /** Open the message in its channel; the sheet closes first. */
  onOpen: (target: ListedMessage) => void;
  /** Remove a Saved row's bookmark. Without it, Saved rows have no Remove. */
  onRemoveSaved?: (messageId: string) => void;
  /**
   * Open a Links row's sheet (#5779). The list stays up under it, so the
   * member comes back to it; the sheet's own actions decide what closes.
   */
  onOpenLink?: (row: LinkRow) => void;
}

const TITLES: Record<MessageListKind, string> = {
  pinned: PINNED_TITLE,
  saved: SAVED_TITLE,
  links: LINKS_TITLE,
};

export const MessageListSheet = forwardRef<
  BottomSheetModal,
  MessageListSheetProps
>(function MessageListSheet(
  { kind, channelId, nameFor, onOpen, onRemoveSaved, onOpenLink },
  ref,
) {
  const closeSheet = useSheetClose(ref);
  // Pinned and Saved: the thread dismisses it on every blur and channel
  // switch, up or not (#4229): the ref it holds only reaches a sheet that is up.
  const { modalRef, onAnimate, markClosed } = useGuardedSheetRef(ref);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const open = (target: ListedMessage) => {
    closeSheet();
    onOpen(target);
  };

  return (
    <BottomSheetModal
      ref={modalRef}
      onAnimate={onAnimate}
      onDismiss={markClosed}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tallSheet}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        stickyHeaderIndices={[0]}
      >
        <View style={styles.stickyHeader}>
          <TallSheetHeader title={TITLES[kind]} onClose={closeSheet} />
        </View>
        {kind === "pinned" ? (
          <PinnedRows channelId={channelId} nameFor={nameFor} onOpen={open} />
        ) : kind === "saved" ? (
          <SavedRows nameFor={nameFor} onOpen={open} onRemove={onRemoveSaved} />
        ) : (
          <LinkRows channelId={channelId} onOpen={onOpenLink} />
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

/** Where a row opens: its channel, and its thread when it is a reply. */
export interface ListedMessage {
  channelId: string;
  messageId: string;
  /** The thread a reply is in (#3785): a reply is never on the timeline. */
  threadRootId: string | null;
}

interface ListRowModel extends ListedMessage {
  key: string;
  author: string;
  sentAt: string;
  preview: string;
  /** The preview is not anyone's words: a tombstone or a placeholder. */
  muted: boolean;
  /** Opens its message; false for a Saved row the viewer can't read now. */
  openable: boolean;
}

function PinnedRows({
  channelId,
  nameFor,
  onOpen,
}: {
  channelId: string | null;
  nameFor: NameResolver;
  onOpen: (target: ListedMessage) => void;
}) {
  const query = usePinnedMessages(channelId ?? "");
  const rows = useMemo<ListRowModel[]>(() => {
    const pins = [...(query.data ?? [])].sort((a, b) =>
      (b.pinned_at ?? "").localeCompare(a.pinned_at ?? ""),
    );
    return pins.map((message) => {
      const blocked =
        (message as { sender_blocked?: boolean }).sender_blocked === true;
      return {
        key: message.id,
        channelId: message.channel_id,
        messageId: message.id,
        threadRootId: message.thread_root_id ?? null,
        author: resolveAuthorLabel(message, nameFor, null),
        sentAt: message.created_at,
        preview: blocked
          ? TOMBSTONE_TEXT
          : // The API's copy read as the cache reads it (#4864).
            replyPreviewText({
              ...message,
              forwarded_from: forwardedFromOf(message.forwarded_from),
            }),
        muted: blocked || message.is_deleted,
        openable: true,
      };
    });
  }, [query.data, nameFor]);

  if (query.isError && query.data === undefined) {
    return (
      <ErrorState
        title="Couldn't load pinned messages"
        body={describeLoadFailure(query.error)}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  if (!channelId || query.isPending) return <RowsSkeleton />;
  return <Rows rows={rows} empty={PINNED_EMPTY} onOpen={onOpen} />;
}

function SavedRows({
  nameFor,
  onOpen,
  onRemove,
}: {
  nameFor: NameResolver;
  onOpen: (target: ListedMessage) => void;
  onRemove?: (messageId: string) => void;
}) {
  const query = useBookmarks();
  const rows = useMemo<ListRowModel[]>(
    () =>
      (query.data ?? []).map((bookmark) => {
        // `!== false`: an older cached payload has no such field (web's rule).
        const available = bookmark.message_available !== false;
        // A blocked member's message comes back masked, with a sentinel for
        // its content: it reads as the thread's tombstone, as a pin does.
        const blocked = bookmark.message.sender_blocked === true;
        return {
          key: bookmark.id,
          channelId: bookmark.message.channel_id,
          messageId: bookmark.message_id,
          threadRootId: bookmark.message.thread_root_id ?? null,
          author: available
            ? resolveAuthorLabel(bookmark.message, nameFor, null)
            : SAVED_UNAVAILABLE,
          sentAt: bookmark.message.created_at,
          preview: blocked
            ? TOMBSTONE_TEXT
            : // A forward with no comment previews its copy (#4875).
              replyPreviewText({
                ...bookmark.message,
                forwarded_from: forwardedFromOf(
                  bookmark.message.forwarded_from,
                ),
              }),
          muted: blocked || bookmark.message.is_deleted || !available,
          openable: available,
        };
      }),
    [query.data, nameFor],
  );

  if (query.isError && query.data === undefined) {
    return (
      <ErrorState
        title="Couldn't load your saved messages"
        body={describeLoadFailure(query.error)}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  if (query.isPending) return <RowsSkeleton />;
  return (
    <Rows rows={rows} empty={SAVED_EMPTY} onOpen={onOpen} onRemove={onRemove} />
  );
}

/**
 * The channel's sign-up links (#5779), drawn with Activity's own row. The
 * read is Activity's (`useActivity`), which the member's Activity tab keeps
 * warm; a failure with nothing cached says so with Retry, as Pinned does.
 * Done and Hide take a row off at once, as they took it off Activity.
 */
function LinkRows({
  channelId,
  onOpen,
}: {
  channelId: string | null;
  onOpen?: (row: LinkRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const activity = useActivity();
  const now = useNowDate();
  const faceFor = useActivityFaces();
  // Opening a row from here reads it, as opening it from Activity did.
  const { markRead } = useActivityUnread(activity.data);
  const rows = useMemo(
    () =>
      activity.data && channelId
        ? activityChannelLinks(activity.data, channelId, now).filter(isLink)
        : [],
    [activity.data, channelId, now],
  );

  if (activity.isError && activity.data === undefined) {
    return (
      <ErrorState
        title="Couldn't load links"
        body={describeLoadFailure(activity.error)}
        onRetry={() => void activity.refetch()}
        isRetrying={activity.isFetching}
      />
    );
  }
  if (!channelId || activity.isPending) {
    return (
      <SkeletonRegion label="Loading links" flush>
        {[0, 1, 2].map((index) => (
          <ActivityRowSkeleton
            key={index}
            index={index}
            isFirst={index === 0}
          />
        ))}
      </SkeletonRegion>
    );
  }
  if (rows.length === 0) {
    return <Text style={styles.empty}>{LINKS_EMPTY}</Text>;
  }
  return (
    <ActivityFaces.Provider value={faceFor}>
      <View>
        {rows.map((row, index) => (
          <ActivityListRow
            key={row.key}
            row={row}
            isFirst={index === 0}
            onPress={() => {
              if (row.unread && row.readRef) markRead([row.readRef]);
              onOpen?.(row);
            }}
          />
        ))}
      </View>
    </ActivityFaces.Provider>
  );
}

function isLink(row: ActivityRow): row is LinkRow {
  return row.kind === "link";
}

function Rows({
  rows,
  empty,
  onOpen,
  onRemove,
}: {
  rows: ListRowModel[];
  empty: string;
  onOpen: (target: ListedMessage) => void;
  onRemove?: (messageId: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  if (rows.length === 0) return <Text style={styles.empty}>{empty}</Text>;
  return (
    <View>
      {rows.map((row) => {
        const body = (
          <>
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={styles.author}>{row.author}</Text>
              {`  ${sentAtLabel(row.sentAt)}`}
            </Text>
            <Text
              style={[styles.preview, row.muted ? styles.mutedPreview : null]}
              numberOfLines={3}
            >
              {row.preview}
            </Text>
          </>
        );
        return (
          <View key={row.key} style={styles.row}>
            {row.openable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Opens this message in its channel."
                onPress={() =>
                  onOpen({
                    channelId: row.channelId,
                    messageId: row.messageId,
                    threadRootId: row.threadRootId,
                  })
                }
                style={({ pressed }) => [
                  styles.rowBody,
                  pressed ? styles.pressed : null,
                ]}
              >
                {body}
              </Pressable>
            ) : (
              <View style={styles.rowBody}>{body}</View>
            )}
            {onRemove ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={removeLabel(row)}
                hitSlop={8}
                onPress={() => onRemove(row.messageId)}
                style={({ pressed }) => [
                  styles.remove,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** The Remove button's name: whose message, where the list can say it. */
export function removeLabel(row: { author: string; openable: boolean }) {
  return row.openable
    ? `Remove ${row.author}'s message from Saved`
    : "Remove this unavailable message from Saved";
}

function RowsSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { label, body } = tokens.typography.role;
  return (
    <SkeletonRegion label="Loading messages" flush>
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.row, styles.rowBody]}>
          <SkeletonText role={label} width="40%" />
          <SkeletonText role={body} width={index % 2 ? "70%" : "90%"} />
        </View>
      ))}
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    // A record sheet's recipe: the side inset is the body's, so the title
    // and the rows line up.
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    stickyHeader: {
      backgroundColor: tokens.color.surface.popover,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    rowBody: {
      flex: 1,
      gap: tokens.spacing.xs,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    author: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    preview: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    mutedPreview: {
      color: tokens.color.text.mutedForeground,
      fontStyle: "italic",
    },
    remove: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingLeft: tokens.spacing.lg,
    },
    removeText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    empty: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingVertical: tokens.spacing.xl,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
