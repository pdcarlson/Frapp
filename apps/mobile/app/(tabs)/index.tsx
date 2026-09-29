import { useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  arrangeChannelSidebar,
  canHideConversation,
  foldedSectionAnnouncement,
  groupChannelsByCategory,
  HIDDEN_CONVERSATIONS_LABEL,
  HIDE_MUTED_LABEL,
  NO_MATCHING_CHANNELS,
  otherMemberId,
  SHOW_ALL_CHANNELS_LABEL,
  SIDEBAR_SAVE_FAILED_BODY,
  SIDEBAR_SAVE_FAILED_TITLE,
  sidebarMutedChannelIds,
  sidebarSections,
  sidebarUnreadCounts,
  UNREAD_ONLY_LABEL,
  useCategories,
  useChannelNotificationPreferences,
  useChannelUnreadCounts,
  useGetOrCreateDm,
  useChannels,
  useEvents,
  useLeaveChannel,
  useMemberDisplayNames,
  useSetChannelPinned,
  useSetSidebarFilter,
  useSetSidebarSectionCollapsed,
  useSidebarPreferences,
  useTasks,
  useViewerUserId,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { AskSheet } from "@/components/ask/ask-sheet";
import { AskPill } from "@/components/chat/ask-pill";
import { ToggleChips } from "@/components/filter-chips";
import { ChannelRow, UnreadBadge } from "@/components/chat/channel-row";
import { UpNextStrip } from "@/components/chat/up-next-strip";
import { isAskAvailable } from "@/lib/ask/flag";
import {
  displayChannelName,
  indexUnread,
  hiddenChannels,
  isDirectChannel,
  listedChannels,
  selectCategories,
  selectChannels,
  type ChannelSummary,
} from "@/lib/chat/channel-list";
import { confirmHideConversation } from "@/lib/chat/hide-conversation-prompt";
import { openChannelRowActions } from "@/lib/chat/channel-row-actions";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s04 — Chat home. Chat is home, so this is the tab bar's `index` route.
 *
 * Three surfaces, top to bottom: the ✦ Ask pill in the header
 * (`navigation.md` § Global entries — only in a build that has Ask), the UP
 * NEXT pulse strip, then the channel list with unread and mention badges.
 *
 * `ScreenShell` is the right host here even though it wraps its children in a
 * `ScrollView`: a chapter's channel list is tens of rows, not thousands, so
 * windowing buys nothing, and the shell already carries the `headerAction` slot
 * S2 added for this exact pill. The thread (s05) is the screen that genuinely
 * needs to escape the shell.
 *
 * **Unread and mention counts are read, never computed** — `GET /v1/channels/unread`
 * via `useChannelUnreadCounts`. `spec/behavior/chat/README.md` § Read Receipts
 * forbids re-deriving either: the server excludes the viewer's own and deleted
 * messages and counts a never-opened channel as fully unread, and a local
 * definition would disagree on exactly those cases.
 */

export default function ChatHomeScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  // s17 is a sheet hosted by its parent screen, not a route
  // (`spec/ui/mobile/patterns.md` § Bottom sheets), so this screen owns the
  // modal and the ✦ pill only presents it — the arrangement `tasks.tsx` uses
  // for s19.
  const askSheetRef = useRef<BottomSheetModal>(null);

  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();
  const unreadQuery = useChannelUnreadCounts();
  const eventsQuery = useEvents();
  const tasksQuery = useTasks();
  // A DM row's title is the *other* participant, so the list needs the viewer's
  // `users.id` to subtract. Deliberately not `useChatRuntime()`, which would
  // reconfigure the realtime manager and boot the outbox flush from this screen.
  const viewerId = useViewerUserId();
  const { byId: memberNames } = useMemberDisplayNames();

  const leaveChannel = useLeaveChannel();
  const reopenDm = useGetOrCreateDm();
  const [showHidden, setShowHidden] = useState(false);

  // A DM the member hid (#2303) is still in the payload, so a thread opened by
  // id keeps resolving. The main list leaves it out; the collapsed Hidden
  // conversations group at the end is the way back to it.
  const allChannels = useMemo(
    () => selectChannels(channelsQuery.data),
    [channelsQuery.data],
  );
  const channels = useMemo(() => listedChannels(allChannels), [allChannels]);
  const hidden = useMemo(() => hiddenChannels(allChannels), [allChannels]);
  const unread = useMemo(
    () => indexUnread(unreadQuery.data ?? []),
    [unreadQuery.data],
  );

  // The member's own arrangement (#2877): pins, folded sections and the two
  // filters, stored server-side so they match web. A failed read leaves the
  // default arrangement, which hides nothing.
  const preferences = useSidebarPreferences();
  // A hook option, not `mutate`'s per-call `onError`, which fires only for the
  // latest write on the hook. The write has already put the list back on the
  // server's state; this says so.
  const sidebarWriteOptions = useMemo(
    () => ({
      onError: () =>
        Alert.alert(SIDEBAR_SAVE_FAILED_TITLE, SIDEBAR_SAVE_FAILED_BODY),
    }),
    [],
  );
  const { mutate: setChannelPinned } = useSetChannelPinned(sidebarWriteOptions);
  const { mutate: setSectionCollapsed } =
    useSetSidebarSectionCollapsed(sidebarWriteOptions);
  const { mutate: setSidebarFilter } = useSetSidebarFilter(sidebarWriteOptions);
  const notificationPrefsQuery = useChannelNotificationPreferences();

  // Categories are grouping only. While they load, or if the read fails,
  // `selectCategories` gives `[]` and every channel sits under CHANNELS, the
  // layout from before categories, rather than the list waiting on them or
  // losing rows.
  const categories = useMemo(
    () => selectCategories(categoriesQuery.data),
    [categoriesQuery.data],
  );
  const arranged = useMemo(() => {
    // Both filters apply only while their data is known. The shared helpers
    // give `undefined` while a read is pending or its last attempt failed, so
    // a filter never hides a row on missing or stale data.
    const unreadByChannelId = sidebarUnreadCounts({
      data: unreadQuery.data,
      isError: unreadQuery.isError,
    });
    const mutedChannelIds = sidebarMutedChannelIds({
      data: notificationPrefsQuery.data,
      isError: notificationPrefsQuery.isError,
    });
    return arrangeChannelSidebar({
      // Labels per `spec/behavior/chat/README.md` § Channels (the "Channel
      // categories" rule): the default group is "Channels", and it stays first
      // below Pinned.
      sections: sidebarSections(groupChannelsByCategory(channels, categories), {
        channels: "CHANNELS",
        direct: "DIRECT",
      }),
      pinnedIds: preferences.pinnedIds,
      collapsed: preferences.collapsed,
      filters: preferences.filters,
      activeChannelId: null,
      titleOf: (channel) => displayChannelName(channel, viewerId, memberNames),
      unreadByChannelId,
      mutedChannelIds,
    });
  }, [
    channels,
    categories,
    preferences,
    unreadQuery.data,
    unreadQuery.isError,
    notificationPrefsQuery.data,
    notificationPrefsQuery.isError,
    viewerId,
    memberNames,
  ]);

  function openChannel(channelId: string) {
    // Object form, because the route takes a param. Note this is invisible to
    // `lib/routes.spec.ts`'s literal scan — the `pathname:` matcher added
    // alongside this slice is what keeps it covered.
    router.push({ pathname: "/chat-thread", params: { channelId } });
  }

  /**
   * Opening a hidden DM from its group is "opening it again yourself", which
   * is what clears a hide: `POST /v1/channels/dm` with the other member does it
   * server-side, and its refetch moves the row back into the list. The thread
   * opens either way — it is readable while hidden — so a failed unhide costs
   * the member nothing but the row staying in the group.
   */
  function reopenHidden(channel: ChannelSummary) {
    const memberId = otherMemberId(channel, viewerId);
    if (memberId) reopenDm.mutate({ member_id: memberId });
    openChannel(channel.id);
  }

  function renderChannel(channel: ChannelSummary) {
    const counts = unread[channel.id];
    const name = displayChannelName(channel, viewerId, memberNames);
    const pinned = preferences.pinnedIds.has(channel.id);
    const togglePin = () =>
      setChannelPinned({ channelId: channel.id, pinned: !pinned });
    const hide = canHideConversation(channel)
      ? () =>
          confirmHideConversation({
            name,
            run: () => leaveChannel.mutateAsync(channel.id),
          })
      : undefined;
    return (
      <ChannelRow
        key={channel.id}
        name={name}
        isDirect={isDirectChannel(channel)}
        isPinned={pinned}
        unreadCount={counts?.unread ?? 0}
        mentionCount={counts?.mentions ?? 0}
        onPress={() => openChannel(channel.id)}
        onHide={hide}
        onTogglePin={togglePin}
        onLongPress={() =>
          openChannelRowActions({
            name,
            pinned,
            onTogglePin: togglePin,
            onHide: hide,
          })
        }
      />
    );
  }

  return (
    <ScreenShell
      title="Chat"
      subtitle="Your chapter's channels and direct messages."
      headerAction={
        // No pill at all in a build without Ask (#2259): `AskSheet` renders
        // nothing then, so the pill would be a control with nothing behind it.
        isAskAvailable() ? (
          <AskPill onPress={() => askSheetRef.current?.present()} />
        ) : undefined
      }
    >
      <UpNextStrip
        events={eventsQuery.data}
        tasks={tasksQuery.data}
        viewerUserId={viewerId}
      />

      {/*
        A failed unread fetch must not read as "everything is read". The counts
        are the only mention signal on this screen, so failing open would tell a
        member they have no @-mentions when they do — the precise failure the
        "never re-derive unread" rule exists to prevent. Say it instead.
      */}
      {unreadQuery.isError ? (
        <Text style={styles.unreadWarning}>
          Unread counts are unavailable right now, so badges may be missing.
        </Text>
      ) : null}

      {channelsQuery.isPending ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={tokens.color.text.muted} />
          <Text style={styles.stateBody}>Loading channels…</Text>
        </View>
      ) : channelsQuery.isError ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Couldn&apos;t load channels</Text>
          <Text style={styles.stateBody}>
            Chat couldn&apos;t reach the server.
          </Text>
          {/*
            An explicit control, because nothing else here would recover: this
            screen is a tab that stays mounted for the session, `ScreenShell`'s
            ScrollView has no RefreshControl to pull, and the copy would
            otherwise have named a pull-to-refresh that does not exist.

            C8 (#998) has since wired `onlineManager` and `focusManager`
            (`lib/connection/query-connectivity.ts`), so a *connectivity* blip
            now recovers on its own and this is no longer the only way back.
            It stays because a server error still has no other recovery.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading channels again"
            disabled={channelsQuery.isFetching}
            onPress={() => void channelsQuery.refetch()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.retryText}>
              {channelsQuery.isFetching ? "Retrying…" : "Try again"}
            </Text>
          </Pressable>
        </View>
      ) : allChannels.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>No channels yet</Text>
          <Text style={styles.stateBody}>
            Channels your chapter creates will appear here.
          </Text>
        </View>
      ) : (
        <>
          {/*
            The two filters (#2877). Chips rather than a menu: the header's one
            action slot is the Ask pill, and the state of each filter should be
            visible without opening anything, since a shortened list would
            otherwise read as a chapter with fewer channels.
          */}
          <ToggleChips
            chips={[
              {
                key: "unread_only",
                label: UNREAD_ONLY_LABEL,
                on: preferences.filters.unreadOnly,
              },
              {
                key: "hide_muted",
                label: HIDE_MUTED_LABEL,
                on: preferences.filters.hideMuted,
              },
            ]}
            onToggle={(key, next) =>
              setSidebarFilter(
                key === "unread_only"
                  ? { unread_only: next }
                  : { hide_muted: next },
              )
            }
          />

          {/*
            Each header folds its section (#2877). Folded, it keeps the
            section's unread total, red when anything inside addresses the
            member, so folding never hides a mention. PINNED is the Canvas's
            section above CHANNELS (canvas-screens.dc.html:135).
          */}
          {arranged.sections.map((section) => (
            <View key={section.key} style={styles.section}>
              {/*
                A header that folds: the header role keeps each section on the
                screen reader's headings rotor, as before #2877, and the
                expanded state says it folds. The label carries a folded
                section's total, since the badge inside is not read on its own.
              */}
              <Pressable
                accessibilityRole="header"
                accessibilityState={{ expanded: !section.collapsed }}
                accessibilityLabel={
                  section.collapsed &&
                  (section.unreadCount > 0 || section.addressed)
                    ? `${section.label}, ${foldedSectionAnnouncement(section)}`
                    : section.label
                }
                onPress={() =>
                  setSectionCollapsed({
                    sectionKey: section.key,
                    collapsed: !section.collapsed,
                  })
                }
                style={({ pressed }) => [
                  styles.sectionHeader,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.sectionChevron}>
                  {section.collapsed ? "▸" : "▾"}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.sectionLabel, styles.sectionLabelInHeader]}
                >
                  {section.label}
                </Text>
                {section.collapsed &&
                (section.unreadCount > 0 || section.addressed) ? (
                  <UnreadBadge
                    unreadCount={section.unreadCount}
                    mentionCount={section.mentionCount}
                    addressed={section.addressed}
                  />
                ) : null}
              </Pressable>
              {section.rows.map(renderChannel)}
            </View>
          ))}

          {arranged.emptiedByFilters ? (
            <View style={styles.stateBlock}>
              <Text style={styles.stateBody}>{NO_MATCHING_CHANNELS}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setSidebarFilter({ unread_only: false, hide_muted: false })
                }
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.retryText}>{SHOW_ALL_CHANNELS_LABEL}</Text>
              </Pressable>
            </View>
          ) : null}

          {hidden.length > 0 ? (
            <View style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showHidden }}
                onPress={() => setShowHidden((open) => !open)}
                style={({ pressed }) => [
                  styles.hiddenToggle,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.sectionLabel}>
                  {`${HIDDEN_CONVERSATIONS_LABEL} (${hidden.length})`}
                </Text>
              </Pressable>
              {showHidden
                ? hidden.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      name={displayChannelName(channel, viewerId, memberNames)}
                      isDirect
                      // A hidden DM carries no count (`GET /v1/channels/unread`
                      // leaves it out), so there is no badge to draw.
                      unreadCount={0}
                      mentionCount={0}
                      onPress={() => reopenHidden(channel)}
                    />
                  ))
                : null}
            </View>
          ) : null}
        </>
      )}

      <AskSheet ref={askSheetRef} />
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    section: {
      gap: tokens.spacing.xs,
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
      marginBottom: tokens.spacing.xs,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
    },
    // Inside the fold control the row carries the spacing, so the label drops
    // its own bottom margin and gives up width to the badge.
    sectionLabelInHeader: {
      flex: 1,
      marginBottom: 0,
    },
    sectionChevron: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    retryButton: {
      marginTop: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.lg,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.card,
    },
    retryText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    pressed: {
      opacity: 0.7,
    },
    hiddenToggle: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    unreadWarning: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
    },
    stateBlock: {
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xl,
      alignItems: "center",
    },
    stateTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    stateBody: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
  });
}
