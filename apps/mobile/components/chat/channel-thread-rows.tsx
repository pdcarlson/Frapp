import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  resolveAuthorLabel,
  resolveAuthorName,
  useMemberThreads,
  type MemberThread,
  type NameResolver,
} from "@repo/hooks";
import {
  memberThreadPreview,
  sidebarThreadsByChannel,
} from "@repo/chat-core/threads";
import type { RawChatMessage } from "@repo/chat-core/types";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { UnreadPip } from "@/components/chat/channel-row";

/** Where a row opens: the thread, over its channel. */
export interface ThreadTarget {
  channelId: string;
  rootId: string;
}

/** The connector's stroke and its elbow's corner. */
const CONNECTOR_WIDTH = 1.5;
const CONNECTOR_RADIUS = 8;

/**
 * The member's active threads by channel, for the rows under each channel
 * (`sidebarThreadsByChannel`). The quiet window is measured from when the
 * list was read, which the minute-by-minute re-read keeps current.
 */
export function useChannelThreads(): Map<string, MemberThread[]> {
  const query = useMemberThreads();
  return useMemo(
    () => sidebarThreadsByChannel(query.data, query.dataUpdatedAt),
    [query.data, query.dataUpdatedAt],
  );
}

/**
 * A channel's active threads, indented under its row (#5277, Paul
 * 2026-11-17), as Discord's channel list draws the threads you're in: a
 * curved connector from the channel's `#` into each thread, named by its
 * parent's words. Which threads show is `sidebarThreadsByChannel`'s rule;
 * a channel with none renders nothing here, so there is no empty state.
 *
 * A thread with replies new to the member reads as an unread channel row
 * does (the leading pip and a bold title, no number: a thread reply is not
 * direct address); a muted thread reads as a muted channel. A tap pushes the
 * thread over its channel, so back returns to the channel.
 *
 * Replaces the Threads row and its All threads sheet (#4960, #5139).
 */
export function ChannelThreadRows({
  threads,
  channelLabel,
  nameFor,
  viewerId,
  markWidth,
  onOpen,
}: {
  threads: readonly MemberThread[] | undefined;
  /** `#general`, or a conversation's people, for the spoken label. */
  channelLabel: string;
  nameFor: NameResolver;
  viewerId: string | null;
  /**
   * The parent row's mark: the `#` slot by default, or a conversation's
   * avatar (`DIRECT_AVATAR_SIZE`), so the connector drops from its middle.
   */
  markWidth?: number;
  onOpen: (target: ThreadTarget) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(
    () => createStyles(tokens, markWidth),
    [tokens, markWidth],
  );
  if (!threads || threads.length === 0) return null;
  const names = {
    nameOf: (id: string) =>
      resolveAuthorName({ sender_id: id, author_name: null }, nameFor),
    fallbackLabel: (id: string) =>
      resolveAuthorLabel({ sender_id: id, author_name: null }, nameFor, null),
  };
  return (
    <View testID="channel-threads">
      {threads.map((thread, index) => {
        const { rootText } = memberThreadPreview(
          thread.root as unknown as RawChatMessage,
          viewerId,
          names,
        );
        const unread = thread.unread_count > 0;
        const muted = thread.state === "muted";
        const last = index === threads.length - 1;
        return (
          <PressableRow
            key={thread.thread_root_id}
            testID="channel-thread-row"
            accessibilityRole="button"
            accessibilityLabel={[
              `Thread: ${rootText}`,
              `in ${channelLabel}`,
              muted ? "muted" : null,
              unread ? `${thread.unread_count} new` : null,
            ]
              .filter(Boolean)
              .join(", ")}
            accessibilityHint="Opens this thread."
            onPress={() =>
              onOpen({
                channelId: thread.channel_id,
                rootId: thread.thread_root_id,
              })
            }
            style={styles.row}
          >
            {unread ? <UnreadPip testID="channel-thread-unread-pip" /> : null}
            <View
              style={styles.connector}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.elbow} />
              {last ? null : <View style={styles.trunk} />}
            </View>
            <Text
              numberOfLines={1}
              style={
                unread
                  ? styles.titleUnread
                  : muted
                    ? styles.titleMuted
                    : styles.titleRead
              }
            >
              {rootText}
            </Text>
          </PressableRow>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens, markWidth?: number) {
  // The parent row's mark (`channel-row.tsx`): the connector drops from its
  // middle, and the thread's words start where the channel's name does.
  const sigil = markWidth ?? tokens.typography.role.title.size;
  const lineX = sigil / 2 - CONNECTOR_WIDTH / 2;
  const line = tokens.color.border.hairline;
  return StyleSheet.create({
    // One line, at the touch minimum, on the channel row's gutter.
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum,
      ...gutterBleed(tokens),
    },
    connector: {
      alignSelf: "stretch",
      width: sigil + tokens.spacing.md,
    },
    // From the row above down to the row's middle, then curving right.
    elbow: {
      position: "absolute",
      left: lineX,
      top: 0,
      height: "50%",
      width: sigil / 2 + tokens.spacing.xs,
      borderLeftWidth: CONNECTOR_WIDTH,
      borderBottomWidth: CONNECTOR_WIDTH,
      borderBottomLeftRadius: CONNECTOR_RADIUS,
      borderColor: line,
    },
    // On every row but the last, the line carries on to the next thread.
    trunk: {
      position: "absolute",
      left: lineX,
      top: "50%",
      bottom: 0,
      width: CONNECTOR_WIDTH,
      backgroundColor: line,
    },
    titleRead: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    titleUnread: {
      flex: 1,
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
    },
    titleMuted: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
    },
  });
}
