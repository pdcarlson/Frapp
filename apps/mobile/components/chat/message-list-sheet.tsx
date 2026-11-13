import { forwardRef, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  resolveAuthorLabel,
  useBookmarks,
  usePinnedMessages,
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
  useSheetClose,
  useTallSheetProps,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";

/**
 * The thread header's two message lists (#3723), the phone's face of web's
 * Pinned and Saved panels (`apps/web/components/chat/channel-menu.tsx`):
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
export type MessageListKind = "pinned" | "saved";

export const PINNED_TITLE = "Pinned messages";
export const SAVED_TITLE = "Saved messages";
export const PINNED_EMPTY =
  "No pinned messages yet. Officers pin what everyone should be able to find.";
export const SAVED_EMPTY =
  "Nothing saved yet. Long-press a message and choose Save message to keep it here.";
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
}

export const MessageListSheet = forwardRef<
  BottomSheetModal,
  MessageListSheetProps
>(function MessageListSheet(
  { kind, channelId, nameFor, onOpen, onRemoveSaved },
  ref,
) {
  const closeSheet = useSheetClose(ref);
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
      ref={ref}
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
          <TallSheetHeader
            title={kind === "pinned" ? PINNED_TITLE : SAVED_TITLE}
            onClose={closeSheet}
          />
        </View>
        {kind === "pinned" ? (
          <PinnedRows channelId={channelId} nameFor={nameFor} onOpen={open} />
        ) : (
          <SavedRows nameFor={nameFor} onOpen={open} onRemove={onRemoveSaved} />
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

export function PinnedRows({
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

export function SavedRows({
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
            : replyPreviewText(bookmark.message),
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
    <SkeletonRegion label="Loading messages">
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
    // The member sheet's recipe: the side inset is the body's, so the title
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
