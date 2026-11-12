import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import {
  canHideConversation,
  compareLatestFirst,
  HIDDEN_CONVERSATIONS_LABEL,
  otherMemberId,
  resolveAuthorLabel,
  resolveAuthorName,
  sidebarUnreadCounts,
  useChannelLatestMessages,
  useChannelNotificationPreferences,
  useChannels,
  useGetOrCreateDm,
  useLeaveChannel,
  useMemberDisplayNames,
  useSidebarPreferences,
  useViewerUserId,
  sidebarMutedChannelIds,
} from "@repo/hooks";
import {
  channelPreviewLine,
  NO_MESSAGES_PREVIEW,
} from "@repo/chat-core/channel-preview";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell, StickyHeader } from "@/components/screen-shell";
import { BACK_TO_CHAT } from "@/components/back-row";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ChannelListSkeleton, ChannelRow } from "@/components/chat/channel-row";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { ErrorState } from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";
import { IconButton } from "@/components/icon-button";
import { PencilGlyph } from "@/components/control-glyphs";
import {
  displayChannelName,
  hiddenChannels,
  isDirectChannel,
  listedChannels,
  selectChannels,
  type ChannelSummary,
} from "@/lib/chat/channel-list";
import { confirmHideConversation } from "@/lib/chat/hide-conversation-prompt";
import { channelsErrorCopy } from "@/lib/chat/channels-error";
import { useShownUnreadCounts } from "@/lib/chat/unread-first-paint";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Messages: the member's direct and group messages on their own screen,
 * behind the door at the top right of Chat home (owner, 2026-11-07, option B
 * of the round-two redesign). Chat home lists only channels.
 *
 * Newest conversation first, as every messaging app orders an inbox, and each
 * row keeps its last line: in a DM the last message is what the member is
 * looking for, where a channel's preview was noise (owner, 2026-11-07). No
 * time on the row, which only abbreviated ("Yesterday", "Oct 27"); the order
 * already says which is newest.
 *
 * Hidden conversations (#2303) moved here from Chat home with the rows they
 * belong to; opening one unhides it, as before.
 */
export default function MessagesScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const viewerId = useViewerUserId();
  const {
    byId: memberNames,
    nameFor,
    avatarFor,
    avatarTintFor,
  } = useMemberDisplayNames();
  // A one-to-one DM wears the other member's photo; a group DM keeps initials.
  const avatarOf = (channel: ChannelSummary) => {
    const memberId = otherMemberId(channel, viewerId);
    return memberId ? avatarFor(memberId) : null;
  };
  // Its initials wear that member's tint, as in the thread (#3860).
  const tintOf = (channel: ChannelSummary) => {
    const memberId = otherMemberId(channel, viewerId);
    return memberId ? avatarTintFor(memberId) : null;
  };
  const channelsQuery = useChannels();
  const unread = useShownUnreadCounts();
  const unreadQuery = unread.query;
  const latestQuery = useChannelLatestMessages();
  const notificationPrefsQuery = useChannelNotificationPreferences();
  const leaveChannel = useLeaveChannel();
  const reopenDm = useGetOrCreateDm();
  const [showHidden, setShowHidden] = useState(false);
  const refresh = useRefetchAll([
    channelsQuery,
    unreadQuery,
    latestQuery,
    notificationPrefsQuery,
  ]);

  const direct = useMemo(
    () => selectChannels(channelsQuery.data).filter(isDirectChannel),
    [channelsQuery.data],
  );
  const latestById = useMemo(
    () => new Map((latestQuery.data ?? []).map((row) => [row.channel_id, row])),
    [latestQuery.data],
  );
  const unreadByChannelId = useMemo(
    () =>
      sidebarUnreadCounts({
        data: unread.data,
        isError: unread.isError,
      }),
    [unread.data, unread.isError],
  );
  const mutedChannelIds = useMemo(
    () =>
      sidebarMutedChannelIds({
        data: notificationPrefsQuery.data,
        isError: notificationPrefsQuery.isError,
      }),
    [notificationPrefsQuery.data, notificationPrefsQuery.isError],
  );
  const titleOf = (channel: ChannelSummary) =>
    displayChannelName(channel, viewerId, memberNames);
  // A DM the member pinned (pins are shared with web's rail) leads, then the
  // rest newest first; a conversation with no message yet sorts last, by name.
  const { pinnedIds } = useSidebarPreferences();
  const listed = useMemo(() => {
    const pinRank = (channel: ChannelSummary) =>
      pinnedIds.has(channel.id) ? 0 : 1;
    // The newest-first rule web's Direct messages list shares (#3774).
    const newestFirst = compareLatestFirst<ChannelSummary>(
      (channel) => latestById.get(channel.id)?.created_at,
      (channel) => displayChannelName(channel, viewerId, memberNames),
    );
    return [...listedChannels(direct)].sort(
      (a, b) => pinRank(a) - pinRank(b) || newestFirst(a, b),
    );
  }, [direct, latestById, pinnedIds, viewerId, memberNames]);
  const hidden = useMemo(() => hiddenChannels(direct), [direct]);

  function openChannel(channelId: string) {
    router.push({ pathname: "/chat-thread", params: { channelId } });
  }

  function previewOf(channel: ChannelSummary): string {
    // Held blank until the previews answer, so no row grows when they land.
    if (!latestQuery.isSuccess) return "";
    const latest = latestById.get(channel.id);
    if (!latest) return NO_MESSAGES_PREVIEW;
    return channelPreviewLine(latest, {
      isOneToOne: channel.type === "DM",
      viewerId,
      nameOf: (author) => resolveAuthorName(author, nameFor),
      fallbackLabel: (author) => resolveAuthorLabel(author, nameFor, null),
    });
  }

  const error = channelsErrorCopy(channelsQuery.error, null);

  return (
    <ScreenShell
      back={BACK_TO_CHAT}
      title="Messages"
      refresh={refresh}
      // New message, where iMessage and Instagram keep it. A DM starts from
      // a member, so it opens the Directory, whose member sheet has Message.
      headerAction={
        <IconButton
          label="New message"
          hint="Opens the Directory to pick someone."
          onPress={() => router.push("/directory")}
        >
          <PencilGlyph color={tokens.color.text.foreground} />
        </IconButton>
      }
    >
      {/* The order comes from the latest messages, so the list waits for
          them (or their failure) rather than reordering under a thumb. */}
      {channelsQuery.isPending || latestQuery.isPending ? (
        <ChannelListSkeleton />
      ) : channelsQuery.isError ? (
        <ErrorState
          title={error.title}
          body={error.body}
          onRetry={() => void channelsQuery.refetch()}
          retryLabel="Try loading messages again"
          isRetrying={channelsQuery.isFetching}
        />
      ) : listed.length === 0 && hidden.length === 0 ? (
        <InlineNote>
          No messages yet. Tap the pencil to pick someone from the Directory.
        </InlineNote>
      ) : (
        <>
          <View style={styles.rows}>
            {listed.map((channel) => {
              const counts = unreadByChannelId?.get(channel.id);
              const name = titleOf(channel);
              return (
                <ChannelRow
                  key={channel.id}
                  name={name}
                  isDirect
                  avatarUrl={avatarOf(channel)}
                  avatarTint={tintOf(channel)}
                  preview={previewOf(channel)}
                  isMuted={mutedChannelIds?.has(channel.id) ?? false}
                  unreadCount={counts?.unreadCount ?? 0}
                  mentionCount={counts?.mentionCount ?? 0}
                  onPress={() => openChannel(channel.id)}
                  onHide={
                    canHideConversation(channel)
                      ? () =>
                          confirmHideConversation({
                            name,
                            run: () => leaveChannel.mutateAsync(channel.id),
                          })
                      : undefined
                  }
                />
              );
            })}
          </View>

          {hidden.length > 0 ? (
            <>
              <StickyHeader>
                <PressableRow
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showHidden }}
                  onPress={() => setShowHidden((open) => !open)}
                  style={styles.hiddenToggle}
                >
                  <Text style={styles.hiddenLabel}>
                    {`${HIDDEN_CONVERSATIONS_LABEL} (${hidden.length})`}
                  </Text>
                </PressableRow>
              </StickyHeader>
              {showHidden ? (
                <View style={styles.rows}>
                  {hidden.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      name={titleOf(channel)}
                      isDirect
                      avatarUrl={avatarOf(channel)}
                      avatarTint={tintOf(channel)}
                      // A hidden DM carries no count (`GET /v1/channels/unread`
                      // leaves it out), so there is no badge to draw.
                      unreadCount={0}
                      mentionCount={0}
                      onPress={() => {
                        // Opening it again is what clears a hide (#2303).
                        const memberId = otherMemberId(channel, viewerId);
                        if (memberId) reopenDm.mutate({ member_id: memberId });
                        openChannel(channel.id);
                      }}
                    />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    rows: {
      gap: tokens.spacing.xs,
    },
    hiddenToggle: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      ...gutterBleed(tokens),
    },
    hiddenLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
