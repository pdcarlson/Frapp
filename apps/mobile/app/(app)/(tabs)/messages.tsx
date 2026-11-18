import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
// Only the ref's type: the field is `SearchField`, at the top of the screen as
// on the Directory, so it needs no keyboard avoidance (#3354 guards fields a
// route draws itself).
import type { TextInput } from "react-native";
import {
  canHideConversation,
  compareLatestFirst,
  HIDDEN_CONVERSATIONS_LABEL,
  otherMemberId,
  resolveAuthorLabel,
  resolveAuthorName,
  searchDirectMessages,
  sidebarUnreadCounts,
  useBlockedUserIds,
  useChannelLatestMessages,
  useChapterRoster,
  useChannelNotificationPreferences,
  useChannels,
  useGetOrCreateDm,
  useLeaveChannel,
  useMemberDisplayNames,
  useNowDate,
  useSidebarPreferences,
  useViewerUserId,
  sidebarMutedChannelIds,
  DM_SEARCH_BLOCK_LIST_FAILED,
  DM_SEARCH_CHECKING_BLOCK_LIST,
  DM_SEARCH_MEMBERS_HEADING,
  DM_SEARCH_PLACEHOLDER,
  DM_SEARCH_ROSTER_FAILED,
  dmChannelIdOf,
  dmSearchNoMatches,
  type DmSearchMember,
} from "@repo/hooks";
import {
  channelPreviewLine,
  conversationReadStatus,
  NO_MESSAGES_PREVIEW,
} from "@repo/chat-core/channel-preview";
import { formatConversationTime, formatTimestampFull } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell, StickyHeader } from "@/components/screen-shell";
import { useRefetchAll } from "@/components/pull-to-refresh";
import {
  ChannelListSkeleton,
  ChannelRow,
  DIRECT_AVATAR_SIZE,
} from "@/components/chat/channel-row";
import {
  ChannelThreadRows,
  useChannelThreads,
} from "@/components/chat/channel-thread-rows";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { ErrorState } from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";
import { HeaderButton } from "@/components/header-button";
import { PencilGlyph } from "@/components/control-glyphs";
import { SearchField } from "@/components/filter-chips";
import {
  START_DM_FAILED_BODY,
  startDmFailedTitle,
} from "@/lib/directory/start-dm";
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

/** Under the search while the roster is still being read. */
const MEMBERS_LOADING = "Loading your chapter's members…";
/** The same, while that read waits for the network. */
const MEMBERS_WAITING_FOR_NETWORK =
  "Your chapter's members will load when you're back online.";

/**
 * Messages: the member's direct and group messages, the third tab since
 * #5310 (Paul's direction B, 2026-11-17), as Instagram and LinkedIn give
 * their inbox its own place in the bar. It was a pushed screen behind a door
 * at the top right of Chat home (owner, 2026-11-07, option B of the
 * round-two redesign) and a swipe left from it (#3774); the tab replaced
 * both. Chat home lists only channels. The tab's badge counts conversations
 * with anything unread (`lib/chat/unread-conversations.ts`).
 *
 * Newest conversation first, as every messaging app orders an inbox, and each
 * row keeps its last line: in a DM the last message is what the member is
 * looking for, where a channel's preview was noise (owner, 2026-11-07). Each
 * row says when that line was sent, and the member's own carries a sent or
 * read check (#5519, Paul, 2026-11-18, reversing the 2026-11-07 "no time on
 * the row"), as WhatsApp's and iMessage's inboxes do. The check is the
 * server's word (`read_status`), which honours every member's Read receipts
 * switch; the row never works it out.
 *
 * Hidden conversations (#2303) moved here from Chat home with the rows they
 * belong to; opening one unhides it, as before.
 *
 * A search field heads the list (#4668, Shawn, 2026-11-12), as Instagram's
 * and iMessage's inbox search and the Directory's own field do: a name narrows
 * the screen to the member's conversations, then everyone else it matches
 * under "Start a conversation", and tapping one of those opens the DM,
 * creating it if needed. The pencil focuses it rather than leaving for the
 * Directory. What it finds is web's people search exactly
 * (`searchDirectMessages` in `@repo/hooks/dm-search`).
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
  // A group DM's active threads sit under its row, as a channel's do on Chat
  // home (#5277).
  const { byChannel: threadsByChannel, query: memberThreadsQuery } =
    useChannelThreads();
  const unread = useShownUnreadCounts();
  const unreadQuery = unread.query;
  const latestQuery = useChannelLatestMessages();
  // The rows' times read this clock, so a tab that never unmounts still
  // moves "4:46 PM" to "Yesterday" (#5519).
  const now = useNowDate();
  const notificationPrefsQuery = useChannelNotificationPreferences();
  const leaveChannel = useLeaveChannel();
  const reopenDm = useGetOrCreateDm();
  // A tap on a member opens the thread as soon as the DM exists; this screen
  // already watches `["channels"]` (the member sheet's Message does the same).
  const startDm = useGetOrCreateDm({ awaitRefetch: false });
  const rosterQuery = useChapterRoster();
  const blockList = useBlockedUserIds();
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<TextInput>(null);
  // The member whose DM is being opened, so no second start runs meanwhile,
  // and a count of picks: any later pick (another row, another member) or
  // leaving the screen bumps it, so a slow start that lands after it opens
  // nothing (web's search and the member sheet guard the same way). A tab is
  // never unmounted, so leaving is a blur: switching tabs or pushing a screen.
  const startingRef = useRef<string | null>(null);
  const pickSeq = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const seq = pickSeq;
      return () => {
        seq.current += 1;
      };
    }, []),
  );
  const refresh = useRefetchAll([
    channelsQuery,
    unreadQuery,
    latestQuery,
    notificationPrefsQuery,
    memberThreadsQuery,
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
  // The newest-first rule web's Direct messages list shares (#3774). The
  // search ranks this order, without pins, as web's does (#4668).
  const newestFirst = useMemo(
    () =>
      [...listedChannels(direct)].sort(
        compareLatestFirst<ChannelSummary>(
          (channel) => latestById.get(channel.id)?.created_at,
          (channel) => displayChannelName(channel, viewerId, memberNames),
        ),
      ),
    [direct, latestById, viewerId, memberNames],
  );
  const listed = useMemo(() => {
    const pinRank = (channel: ChannelSummary) =>
      pinnedIds.has(channel.id) ? 0 : 1;
    // A stable sort, so the newest-first order holds within each half.
    return [...newestFirst].sort((a, b) => pinRank(a) - pinRank(b));
  }, [newestFirst, pinnedIds]);
  const hidden = useMemo(() => hiddenChannels(direct), [direct]);

  const searching = query.trim().length > 0;
  const found = useMemo(
    () =>
      searchDirectMessages({
        query,
        conversations: newestFirst,
        titleOf: (channel) =>
          displayChannelName(channel, viewerId, memberNames),
        roster: (rosterQuery.data ?? []) as DmSearchMember[],
        names: memberNames,
        viewerId,
        blockedIds: blockList.ids,
        blockListReady: blockList.status === "ready",
      }),
    [
      query,
      newestFirst,
      viewerId,
      memberNames,
      rosterQuery.data,
      blockList.ids,
      blockList.status,
    ],
  );
  // Why no members are listed, so a search with none never reads as "nobody
  // matches": the block list isn't read yet (as the member sheet's Message
  // row says it), or the roster couldn't be read. Web's search says the same.
  const rosterFailed = rosterQuery.isError && rosterQuery.data === undefined;
  let heldNote: string | null = null;
  let retryHeld: (() => void) | undefined;
  if (searching && found.membersHeld) {
    const failed = blockList.status === "unavailable" && !blockList.isRetrying;
    heldNote = failed
      ? DM_SEARCH_BLOCK_LIST_FAILED
      : DM_SEARCH_CHECKING_BLOCK_LIST;
    if (failed && !blockList.isPaused) retryHeld = blockList.retry;
  } else if (searching && rosterFailed) {
    heldNote = DM_SEARCH_ROSTER_FAILED;
    if (!rosterQuery.isFetching) retryHeld = () => void rosterQuery.refetch();
  } else if (searching && rosterQuery.data === undefined) {
    // Still reading it; offline under `offlineFirst` the read waits for the
    // network, which can be a long time, so it says so.
    heldNote =
      rosterQuery.fetchStatus === "paused"
        ? MEMBERS_WAITING_FOR_NETWORK
        : MEMBERS_LOADING;
  }

  async function startConversation(member: DmSearchMember) {
    if (startingRef.current !== null) return;
    const seq = ++pickSeq.current;
    startingRef.current = member.user_id;
    try {
      const channelId = dmChannelIdOf(
        await startDm.mutateAsync({ member_id: member.user_id }),
      );
      if (seq !== pickSeq.current) return;
      if (!channelId) throw new Error("No channel id returned");
      setQuery("");
      openChannel(channelId);
    } catch {
      if (seq !== pickSeq.current) return;
      Alert.alert(
        startDmFailedTitle(member.display_name),
        START_DM_FAILED_BODY,
      );
    } finally {
      startingRef.current = null;
    }
  }

  // Thread rows go under the list's rows, not under a search result (#5277).
  function renderConversation(
    channel: ChannelSummary,
    { withThreads = true }: { withThreads?: boolean } = {},
  ) {
    const counts = unreadByChannelId?.get(channel.id);
    const name = titleOf(channel);
    const latest = latestQuery.isSuccess
      ? latestById.get(channel.id)
      : undefined;
    return (
      <Fragment key={channel.id}>
        <ChannelRow
          name={name}
          isDirect
          avatarUrl={avatarOf(channel)}
          avatarTint={tintOf(channel)}
          preview={previewOf(channel)}
          time={latest ? formatConversationTime(latest.created_at, now) : null}
          timeLabel={latest ? formatTimestampFull(latest.created_at) : null}
          readStatus={conversationReadStatus(latest, viewerId)}
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
        <ChannelThreadRows
          threads={withThreads ? threadsByChannel.get(channel.id) : undefined}
          channelLabel={name}
          nameFor={nameFor}
          viewerId={viewerId}
          markWidth={DIRECT_AVATAR_SIZE}
        />
      </Fragment>
    );
  }

  function openChannel(channelId: string) {
    pickSeq.current += 1;
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
  const listLoading = channelsQuery.isPending || latestQuery.isPending;
  const listFailed = channelsQuery.isError && channelsQuery.data === undefined;

  return (
    <ScreenShell
      keyboardShouldPersistTaps="handled"
      title="Messages"
      refresh={refresh}
      // New message, where iMessage and Instagram keep it. It focuses the
      // search below, as their pencil opens a "To:" field (#4668).
      headerAction={
        <HeaderButton
          label="New message"
          hint="Opens the search to find someone."
          onPress={() => searchRef.current?.focus()}
        >
          <PencilGlyph color={tokens.color.text.foreground} />
        </HeaderButton>
      }
    >
      {/* Drawn in every state, so the pencil always has a field to focus:
          a member can still be found and messaged while the list loads or
          after it failed, as the Directory's Message could before. */}
      <SearchField
        inputRef={searchRef}
        value={query}
        onChangeText={setQuery}
        placeholder={DM_SEARCH_PLACEHOLDER}
        accessibilityLabel={DM_SEARCH_PLACEHOLDER}
        searchGlyph
      />
      {searching ? null : listLoading ? (
        /* The order comes from the latest messages, so the list waits for
           them (or their failure) rather than reordering under a thumb. */
        <ChannelListSkeleton />
      ) : listFailed ? (
        <ErrorState
          title={error.title}
          body={error.body}
          onRetry={() => void channelsQuery.refetch()}
          retryLabel="Try loading messages again"
          isRetrying={channelsQuery.isFetching}
        />
      ) : null}
      {searching || (!listLoading && !listFailed) ? (
        <>
          {searching ? (
            <>
              <View style={styles.rows}>
                {found.conversations.map((channel) =>
                  renderConversation(channel, { withThreads: false }),
                )}
              </View>
              {found.members.length > 0 ? (
                <>
                  <Text accessibilityRole="header" style={styles.heading}>
                    {DM_SEARCH_MEMBERS_HEADING}
                  </Text>
                  <View style={styles.rows}>
                    {found.members.map((member) => (
                      <ChannelRow
                        key={member.user_id}
                        name={member.display_name}
                        isDirect
                        avatarUrl={avatarFor(member.user_id)}
                        avatarTint={avatarTintFor(member.user_id)}
                        unreadCount={0}
                        mentionCount={0}
                        onPress={() => void startConversation(member)}
                      />
                    ))}
                  </View>
                </>
              ) : null}
              {heldNote ? (
                <InlineNote
                  action={
                    retryHeld
                      ? { label: "Try again", onPress: retryHeld }
                      : undefined
                  }
                >
                  {heldNote}
                </InlineNote>
              ) : found.conversations.length === 0 &&
                found.members.length === 0 ? (
                <InlineNote>{dmSearchNoMatches(query)}</InlineNote>
              ) : null}
            </>
          ) : listed.length === 0 && hidden.length === 0 ? (
            <InlineNote>
              No messages yet. Search for someone above to start one.
            </InlineNote>
          ) : (
            <>
              <View style={styles.rows}>
                {listed.map((channel) => renderConversation(channel))}
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
                            if (memberId)
                              reopenDm.mutate({ member_id: memberId });
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
        </>
      ) : null}
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
    heading: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.md,
    },
    hiddenLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
