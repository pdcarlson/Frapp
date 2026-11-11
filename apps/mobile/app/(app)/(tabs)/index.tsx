import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { setChannelLocked, syncLockedChannels } from "@repo/chat-core/density";
import {
  arrangeChannelSidebar,
  foldedSectionAnnouncement,
  groupChannelsByCategory,
  NO_MATCHING_CHANNELS,
  SHOW_ALL_CHANNELS_LABEL,
  SIDEBAR_SAVE_FAILED_BODY,
  SIDEBAR_SAVE_FAILED_TITLE,
  sidebarMutedChannelIds,
  sidebarSections,
  sidebarUnreadCounts,
  useCategories,
  useChannelNotificationPreferences,
  lastChannelLandingId,
  useActiveChapterId,
  useChannels,
  useChapterScope,
  canSetChannelBackground,
  canSetChannelDisplayLock,
  useRequestChatBackgroundPhotoUrl,
  useSetChannelBackground,
  useSetChannelDisplayLock,
  useChapterSetupChecklist,
  useChapterRoster,
  useCurrentUser,
  useNotifications,
  useEvents,
  useMemberDisplayNames,
  useSetChannelPinned,
  useSetSidebarFilter,
  useSetSidebarSectionCollapsed,
  useSidebarPreferences,
  useSidebarPreferencesRefetch,
  useTasks,
  useViewerUserId,
  channelRowActions,
  deleteChannelConfirmTitle,
  DELETE_CHANNEL_CONFIRM_BODY,
  DELETE_CHANNEL_LABEL,
  useDeleteChannel,
  useMarkChannelRead,
  usePermissionList,
  useSetChannelNotificationLevel,
  type ChannelRowActionKey,
  type ChatNotificationLevel,
  useOwnAvatarTint,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ChapterMark } from "@/components/chapter-mark";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { PushReminder } from "@/components/notifications/push-reminder";
import { useTourAnchor, useTourReady } from "@/components/onboarding/tour";
import { ScreenShell, StickyHeader } from "@/components/screen-shell";
import { AskSheet } from "@/components/ask/ask-sheet";
import { StatusSheet } from "@/components/account/status-sheet";
import { AskPill } from "@/components/chat/ask-pill";
import { selectFromChapterLevel } from "@/components/chat/notification-level-control";
import {
  AccountButton,
  AccountMenu,
  MessagesButton,
  useAccountMenu,
} from "@/components/chat/home-header";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { selectViewerProfile } from "@/lib/more/profile";
import {
  ChannelFilterButton,
  ChannelFilterMenu,
  useChannelFilterMenu,
} from "@/components/chat/channel-filter-menu";
import {
  ChannelListSkeleton,
  ChannelRow,
  UnreadBadge,
} from "@/components/chat/channel-row";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { ErrorState, NoChapterState } from "@/components/state-block";
import {
  MOBILE_SETUP_CHECKLIST_OMIT,
  SetupChecklistView,
} from "@/components/chat/setup-checklist";
import { UpNextStrip } from "@/components/chat/up-next-strip";
import { isAskAvailable } from "@/lib/ask/flag";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  displayChannelName,
  isDirectChannel,
  listedChannels,
  selectCategories,
  selectChannels,
  type ChannelSummary,
} from "@/lib/chat/channel-list";
import {
  channelsErrorCopy,
  reportChannelsRefused,
} from "@/lib/chat/channels-error";
import {
  chatLaunchOpen,
  chatLaunchWindowLeftMs,
  claimChatLaunch,
  readLastChannel,
  settleChatLaunch,
} from "@/lib/chat/last-channel";
import { useShownUnreadCounts } from "@/lib/chat/unread-first-paint";
import { saveChatBackgroundPick } from "@/lib/chat/chat-background-photo";
import {
  ChannelActionsMenu,
  type ChannelActionsMenuTarget,
} from "@/components/chat/channel-actions-menu";
import { useConnection } from "@/lib/connection/use-connection";
import { pressHaptic } from "@/lib/haptics";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { InlineNote } from "@/components/inline-note";

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

/** The line under the first heading while a filter is on, so a short list says why. */
function filterLineText(filters: { unreadOnly: boolean; hideMuted: boolean }) {
  if (filters.unreadOnly && filters.hideMuted) {
    return "Showing unread only, muted hidden.";
  }
  return filters.unreadOnly ? "Showing unread only." : "Muted channels hidden.";
}

export default function ChatHomeScreen() {
  const { tokens } = useFrappTheme();
  // Your initials wear the color the chapter sees on them (#3860).
  const ownTint = useOwnAvatarTint();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  // s17 is a sheet hosted by its parent screen, not a route
  // (`spec/ui/mobile/patterns.md` § Bottom sheets), so this screen owns the
  // modal and the ✦ pill only presents it — the arrangement `tasks.tsx` uses
  // for s19.
  const askSheetRef = useRef<BottomSheetModal>(null);
  const statusSheetRef = useRef<BottomSheetModal>(null);
  // Chat home is titled by the chapter, its mark and name, not by the word
  // "Chat" (`components/chapter-mark.tsx`).
  const { chapterName } = useChapterBranding();

  const channelsQuery = useChannels();
  // `none` when the server can't scope a chat read (#4094): the reads then
  // never go out, so the list would otherwise sit on its skeleton.
  const chapterScope = useChapterScope();
  const setDisplayLock = useSetChannelDisplayLock();
  const setChannelBackground = useSetChannelBackground();
  const requestBackgroundPhotoUrl = useRequestChatBackgroundPhotoUrl();
  const channelsError = channelsErrorCopy(channelsQuery.error, chapterName);
  useEffect(() => {
    if (channelsQuery.isError) reportChannelsRefused(channelsQuery.error);
  }, [channelsQuery.isError, channelsQuery.error]);
  // The first-run tour waits for the list, so its first spot lands on rows
  // (`components/onboarding/tour.tsx`).
  useTourReady(!channelsQuery.isPending, chapterName);
  const channelsAnchor = useTourAnchor("channels");
  const categoriesQuery = useCategories();
  // The server's counts, with what the phone already holds laid over until
  // they answer (`lib/chat/unread-first-paint.ts`, #4006).
  const unread = useShownUnreadCounts();
  const unreadQuery = unread.query;
  const eventsQuery = useEvents();
  const tasksQuery = useTasks();
  // A DM row's title is the *other* participant, so the list needs the viewer's
  // `users.id` to subtract. Deliberately not `useChatRuntime()`, which would
  // boot the outbox flush from this screen. The badges stay live without it:
  // the realtime manager is bound app-wide (`useChatRealtimeBinding`, #3698).
  const viewerId = useViewerUserId();
  const { byId: memberNames } = useMemberDisplayNames();

  // A DM the member hid (#2303) is still in the payload, so a thread opened by
  // id keeps resolving. The list leaves it out.
  const allChannels = useMemo(
    () => selectChannels(channelsQuery.data),
    [channelsQuery.data],
  );
  // Always formal (#3787): copied where every thread row reads its density.
  // Only from a loaded list, so a refetch in flight never clears a lock.
  useEffect(() => {
    if (channelsQuery.data) syncLockedChannels(allChannels);
  }, [channelsQuery.data, allChannels]);
  // Chat home lists channels only; direct messages live behind the Messages
  // door at the top right (owner, 2026-11-07).
  const channels = useMemo(
    () =>
      listedChannels(allChannels).filter(
        (channel) => !isDirectChannel(channel),
      ),
    [allChannels],
  );
  const directChannels = useMemo(
    () => listedChannels(allChannels).filter(isDirectChannel),
    [allChannels],
  );
  // One map for the rows' badges and the arrangement alike, so a folded
  // header and the rows never disagree. `undefined` while the counts are
  // unknown (pending, or the last read failed): rows then draw no badge (after
  // a failure the warning below says why), and Unread only hides nothing.
  const unreadByChannelId = useMemo(
    () =>
      sidebarUnreadCounts({
        data: unread.data,
        isError: unread.isError,
      }),
    [unread.data, unread.isError],
  );
  const accountMenu = useAccountMenu();

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

  // A row's long-press menu (owner, 2026-11-06): web's right-click actions in
  // our own glass menu. Which rows show is `channelRowActions`, scoped to the
  // member's permissions, so Delete channel needs `channels:manage`.
  const permissions = usePermissionList();
  const markRead = useMarkChannelRead();
  const setNotificationLevel = useSetChannelNotificationLevel();
  const deleteChannel = useDeleteChannel();
  // A level pick is a queueless write, so the menu locks it offline the way
  // the thread header's level control does (connection-state.md).
  const { writeBlockedReason } = useConnection();
  const [menuTarget, setMenuTarget] = useState<
    | (ChannelActionsMenuTarget & {
        onTogglePin: () => void;
      })
    | null
  >(null);
  const closeMenu = useCallback(() => setMenuTarget(null), []);
  const levelFor = useCallback(
    (channelId: string): ChatNotificationLevel | undefined =>
      notificationPrefsQuery.data?.find((row) => row.channel_id === channelId)
        ?.level,
    [notificationPrefsQuery.data],
  );
  function runMenuAction(key: ChannelRowActionKey) {
    const target = menuTarget;
    if (!target) return;
    switch (key) {
      case "mark-read":
        markRead.mutate(target.channelId);
        return;
      case "toggle-pin":
        target.onTogglePin();
        return;
      case "delete":
        Alert.alert(
          deleteChannelConfirmTitle(target.name),
          DELETE_CHANNEL_CONFIRM_BODY,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: DELETE_CHANNEL_LABEL,
              style: "destructive",
              onPress: () => {
                deleteChannel
                  .mutateAsync(target.channelId)
                  .catch(() =>
                    Alert.alert(
                      "Couldn't delete the channel",
                      "Nothing changed. Check your connection and try again.",
                    ),
                  );
              },
            },
          ],
        );
        return;
      default:
        // Copy link and Edit channel are web's (the surface below leaves
        // them out), and Notifications opens in the menu itself.
        return;
    }
  }
  // Everything the screen draws: rows, categories, badges, the agenda, mute
  // state, the arrangement, the names a DM row is titled with, the viewer a
  // DM title subtracts, and the header bell's inbox.
  const sidebarRefetch = useSidebarPreferencesRefetch();
  const rosterQuery = useChapterRoster();
  const viewerQuery = useCurrentUser();
  const viewerProfile = useMemo(
    () => selectViewerProfile(viewerQuery.data),
    [viewerQuery.data],
  );
  const inboxQuery = useNotifications();
  // The officer setup checklist. Held here, not in its view, so the pull below
  // re-reads the lists it counts.
  const setup = useChapterSetupChecklist({
    omit: MOBILE_SETUP_CHECKLIST_OMIT,
  });
  const refresh = useRefetchAll([
    { refetch: setup.refetch },
    viewerQuery,
    inboxQuery,
    channelsQuery,
    categoriesQuery,
    unreadQuery,
    eventsQuery,
    tasksQuery,
    notificationPrefsQuery,
    sidebarRefetch,
    rosterQuery,
  ]);

  // Categories are grouping only. While they load, or if the read fails,
  // `selectCategories` gives `[]` and every channel sits under CHANNELS, the
  // layout from before categories, rather than the list waiting on them or
  // losing rows.
  const categories = useMemo(
    () => selectCategories(categoriesQuery.data),
    [categoriesQuery.data],
  );
  // Both filters apply only while their data is known. The shared helpers
  // give `undefined` while a read is pending or its last attempt failed, so a
  // filter never hides a row on missing or stale data.
  const mutedChannelIds = useMemo(
    () =>
      sidebarMutedChannelIds({
        data: notificationPrefsQuery.data,
        isError: notificationPrefsQuery.isError,
      }),
    [notificationPrefsQuery.data, notificationPrefsQuery.isError],
  );
  // The Messages door's badge: conversations with anything unread. A muted
  // DM counts too: anything unread in a DM addresses the member, and that
  // gets past a mute, as it does on the row and for push (§ Sidebar
  // arrangement, Hide muted).
  const unreadConversations = directChannels.filter(
    (channel) => (unreadByChannelId?.get(channel.id)?.unreadCount ?? 0) > 0,
  ).length;
  const filterMenu = useChannelFilterMenu();
  const titleOf = useCallback(
    (channel: ChannelSummary) =>
      displayChannelName(channel, viewerId, memberNames),
    [viewerId, memberNames],
  );
  const arranged = useMemo(() => {
    return arrangeChannelSidebar({
      // Labels per `spec/behavior/chat/README.md` § Channels (the "Channel
      // categories" rule): the default group is "Channels", and it stays first
      // below Pinned.
      sections: sidebarSections(groupChannelsByCategory(channels, categories), {
        channels: "Channels",
        direct: "Direct messages",
      }),
      pinnedIds: preferences.pinnedIds,
      collapsed: preferences.collapsed,
      // Unread only hides nothing on counts that aren't the server's yet.
      filters: unread.provisional
        ? { ...preferences.filters, unreadOnly: false }
        : preferences.filters,
      activeChannelId: null,
      titleOf,
      unreadByChannelId,
      mutedChannelIds,
    });
  }, [
    channels,
    categories,
    preferences,
    unread.provisional,
    unreadByChannelId,
    mutedChannelIds,
    titleOf,
  ]);
  const filtersOn =
    preferences.filters.unreadOnly || preferences.filters.hideMuted;

  /*
    Launch opens the last channel the member was in, the way Discord does
    (owner, 2026-11-05). Once per app process, only once the list has
    answered, so a channel that was deleted or is no longer visible falls
    through to this list instead of a thread that cannot load. A notification
    tap that launched the app goes where it points instead, and so does
    anything the member does before the list answers: leaving chat home
    settles the launch, and so does the launch window running out
    (`lib/chat/last-channel.ts`). Back from the thread returns here.

    A link that cold-launches the app onto a pushed screen mounts chat home
    under it, unfocused, as the stack's anchor (`app/(app)/_layout.tsx`).
    That launch went where the link points, so chat home settles it rather
    than pushing a channel over the linked screen.
  */
  useFocusEffect(useCallback(() => () => settleChatLaunch(), []));
  const isFocused = useIsFocused();
  const chapterId = useActiveChapterId();
  const listAnswered = channelsQuery.isSuccess;
  // While the jump may still happen the list stays behind the skeleton, and
  // the thread opens with no slide, so launch reads as landing in the channel
  // rather than the list flashing and a channel sliding over it (owner,
  // 2026-11-07). A failed list read, or a launch that settles without a jump,
  // lets the list show.
  const [holdingForLaunch, setHoldingForLaunch] = useState(() =>
    chatLaunchOpen(),
  );
  useEffect(() => {
    if (!holdingForLaunch) return;
    if (channelsQuery.isError || viewerQuery.isError || !isFocused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- release the launch hold on an external edge (a failed list or account read, chat home losing focus)
      setHoldingForLaunch(false);
    }
    // Past the launch window the jump can no longer happen.
    const timer = setTimeout(
      () => setHoldingForLaunch(false),
      chatLaunchWindowLeftMs(),
    );
    return () => clearTimeout(timer);
  }, [holdingForLaunch, channelsQuery.isError, viewerQuery.isError, isFocused]);
  useEffect(() => {
    if (!listAnswered || !viewerId) return;
    if (!isFocused) {
      settleChatLaunch();
      return;
    }
    // No cancellation on cleanup: the claim is spent either way, and a
    // cancelled read would lose the jump for good (Strict Mode re-runs this).
    if (!claimChatLaunch()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the launch claim is a one-shot module flag outside React; nothing to hold for once it is spent
      setHoldingForLaunch(false);
      return;
    }
    void readLastChannel(viewerId, chapterId)
      .then((stored) => {
        const target = lastChannelLandingId(allChannels, stored);
        if (target) openChannel(target, { landing: true });
      })
      .finally(() => {
        // After the push, so the list is already covered when it shows.
        setHoldingForLaunch(false);
      });
    // Launch-only: `claimChatLaunch` makes later runs no-ops, so the list
    // changing afterwards never re-opens anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listAnswered, viewerId]);

  function openChannel(channelId: string, options?: { landing?: boolean }) {
    // Object form, because the route takes a param. Note this is invisible to
    // `lib/routes.spec.ts`'s literal scan — the `pathname:` matcher added
    // alongside this slice is what keeps it covered. `landing` opens it with
    // no slide (`app/(app)/_layout.tsx`): the launch jump.
    router.push({
      pathname: "/chat-thread",
      params: options?.landing ? { channelId, landing: "1" } : { channelId },
    });
  }

  function renderChannel(channel: ChannelSummary) {
    const counts = unreadByChannelId?.get(channel.id);
    const name = displayChannelName(channel, viewerId, memberNames);
    const pinned = preferences.pinnedIds.has(channel.id);
    const togglePin = () =>
      setChannelPinned({ channelId: channel.id, pinned: !pinned });
    return (
      <ChannelRow
        key={channel.id}
        name={name}
        isPinned={pinned}
        isMuted={mutedChannelIds?.has(channel.id) ?? false}
        unreadCount={counts?.unreadCount ?? 0}
        mentionCount={counts?.mentionCount ?? 0}
        onPress={() => openChannel(channel.id)}
        onTogglePin={togglePin}
        onLongPress={(event) => {
          pressHaptic();
          setMenuTarget({
            channelId: channel.id,
            name,
            // A screen reader's "Channel actions" has no press point, so the
            // menu opens a third of the way down.
            pageY: event?.nativeEvent.pageY ?? windowHeight / 3,
            pinned,
            level: levelFor(channel.id),
            fromChapterLevel: selectFromChapterLevel(
              notificationPrefsQuery.data,
              channel.id,
            ),
            actions: channelRowActions({
              channel,
              unread:
                (counts?.unreadCount ?? 0) > 0 ||
                (counts?.mentionCount ?? 0) > 0,
              pinned,
              permissions,
              surface: { copyLink: false, edit: false },
            }),
            canSetDisplayLock: canSetChannelDisplayLock(
              channel,
              viewerId,
              permissions,
            ),
            canSetBackground: canSetChannelBackground(channel, permissions),
            onTogglePin: togglePin,
          });
        }}
      />
    );
  }

  const filterButton = (
    <ChannelFilterButton menu={filterMenu} active={filtersOn} />
  );
  // While a filter is on, the first heading says so in a line, so a short
  // list never reads as a chapter with fewer channels.
  const filterLine = filtersOn ? (
    <View style={styles.filterLine}>
      <Text style={styles.filterLineText}>
        {filterLineText(preferences.filters)}{" "}
      </Text>
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() =>
          setSidebarFilter({ unread_only: false, hide_muted: false })
        }
      >
        <Text style={styles.filterLineAction}>Show all</Text>
      </Pressable>
    </View>
  ) : null;
  // The sections' stand-in while a filter has emptied them all, so the
  // button that undoes it stays on screen. It doesn't fold.
  const emptiedHeading = (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.heading, styles.plainHeading]}
        >
          Channels
        </Text>
        {filterButton}
      </View>
      {filterLine}
    </View>
  );

  return (
    <ScreenShell
      title={chapterName ?? "Frapp"}
      titleMark={<ChapterMark />}
      refresh={refresh}
      overlay={{
        open: filterMenu.visible || accountMenu.visible,
        content: accountMenu.visible ? (
          <AccountMenu
            menu={accountMenu}
            onStatus={() => statusSheetRef.current?.present()}
          />
        ) : (
          <ChannelFilterMenu
            menu={filterMenu}
            unreadOnly={preferences.filters.unreadOnly}
            hideMuted={preferences.filters.hideMuted}
            onChange={setSidebarFilter}
          />
        ),
      }}
      headerAction={
        <View style={styles.headerActions}>
          {/* No pill at all in a build without Ask (#2259): `AskSheet`
              renders nothing then, so the pill would be a control with
              nothing behind it. */}
          {isAskAvailable() ? (
            <AskPill onPress={() => askSheetRef.current?.present()} />
          ) : null}
          {/* The Messages door, then the member's avatar, whose menu holds
              Profile, Notifications (the inbox, #3362) and Settings
              (owner, 2026-11-07). */}
          <MessagesButton unreadConversations={unreadConversations} />
          <AccountButton
            menu={accountMenu}
            initials={viewerProfile?.initials ?? "?"}
            photoUrl={viewerProfile?.photoUrl ?? null}
            fetchedAt={viewerQuery.dataUpdatedAt}
            tint={ownTint}
          />
        </View>
      }
    >
      <UpNextStrip
        events={eventsQuery.data}
        tasks={tasksQuery.data}
        viewerUserId={viewerId}
      />

      {/*
        The officer setup checklist (spec/product/modules.md § Setup
        checklist), under UP NEXT and above the channels, as the web rail
        draws it above its channel list. Only once channels have loaded, so it
        never sits on top of the skeleton or the error.
      */}
      {setup.checklist &&
      !channelsQuery.isPending &&
      !holdingForLaunch &&
      !channelsQuery.isError ? (
        <SetupChecklistView
          checklist={setup.checklist}
          onHide={setup.hide}
          onReturnFromWeb={() => void setup.refetch()}
        />
      ) : null}

      {/*
        The one reminder to turn push on, the come-back for onboarding's
        "Not now" (`shouldOfferReminder`). Under the checklist, and only once
        channels have loaded, for the same reason the checklist waits.
      */}
      {!channelsQuery.isPending &&
      !holdingForLaunch &&
      !channelsQuery.isError ? (
        <PushReminder />
      ) : null}

      {/*
        A failed unread fetch must not read as "everything is read". The counts
        are the only mention signal on this screen, so failing open would tell a
        member they have no @-mentions when they do — the precise failure the
        "never re-derive unread" rule exists to prevent. Say it instead.
      */}
      {unread.isError ? (
        <Text style={styles.unreadWarning}>
          Unread counts are unavailable right now, so badges may be missing.
        </Text>
      ) : null}

      {chapterScope === "none" ? (
        // A member with no membership is on their way to `/join`
        // (`useOnboardingRedirect`); this is what a member of several
        // chapters with no chapter claim sees.
        <NoChapterState noun="its channels" />
      ) : channelsQuery.isPending || holdingForLaunch ? (
        <ChannelListSkeleton />
      ) : channelsQuery.isError ? (
        // An explicit retry as well as the pull (#3385): this tab stays
        // mounted for the session, and a button is the recovery a member
        // sees without knowing the gesture. A *connectivity* blip
        // recovers on its own since C8 (#998) wired `onlineManager` and
        // `focusManager` (`lib/connection/query-connectivity.ts`).
        <ErrorState
          title={channelsError.title}
          body={channelsError.body}
          onRetry={() => void channelsQuery.refetch()}
          // Names what it retries, so the button still makes sense heard on
          // its own (a screen reader's list of buttons) and not only under
          // the card's title.
          retryLabel="Try loading channels again"
          isRetrying={channelsQuery.isFetching}
        />
      ) : channels.length === 0 ? (
        // No line saying channels appear here, which would only restate what
        // Chat is for; the one line says what to do, since mobile has no way
        // to create a channel (writing.md §4, as amended 2026-11-05).
        <InlineNote>No channels yet. Ask an admin to add one.</InlineNote>
      ) : (
        <>
          {/*
            The list (2026-11-06 redesign): the member's sections, each row
            with its latest message and time. The filters sit behind the
            button at the end of the first heading, as web's rail keeps them
            behind its Channels header; they used to be two chips above the
            list.
          */}
          {arranged.sections.length === 0
            ? emptiedHeading
            : arranged.sections.flatMap((section, index) => {
                // The heading pins while its rows scroll under it (owner
                // 2026-11-07), so it is the shell's own child, with the rows
                // after it, not inside a section view (`StickyHeader`).
                const line = index === 0 ? filterLine : null;
                return [
                  <StickyHeader key={`${section.key}:heading`}>
                    <View style={styles.headingRow}>
                      {/*
                      A header that folds (#2877). Folded, it keeps the
                      section's unread total, red when anything inside
                      addresses the member, so folding never hides a mention.
                      The header role keeps each section on the screen
                      reader's headings rotor. A header has no button trait,
                      and iOS never announces "collapsed", so the label says
                      whether the section is folded and the hint says what a
                      double-tap does.
                    */}
                      <PressableRow
                        accessibilityRole="header"
                        accessibilityState={{ expanded: !section.collapsed }}
                        accessibilityLabel={
                          section.collapsed
                            ? section.unreadCount > 0 || section.addressed
                              ? `${section.label}, folded, ${foldedSectionAnnouncement(section)}`
                              : `${section.label}, folded`
                            : section.label
                        }
                        accessibilityHint={
                          section.collapsed
                            ? "Double-tap to show its channels."
                            : "Double-tap to fold this section."
                        }
                        onPress={() =>
                          setSectionCollapsed({
                            sectionKey: section.key,
                            collapsed: !section.collapsed,
                          })
                        }
                        style={[styles.sectionHeader, styles.headingGrow]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.heading,
                            styles.headingInHeader,
                            // Folded over something unread: reads as an
                            // unread row does, since only a mention or DM
                            // carries a number (2026-11-07).
                            section.collapsed && section.unreadCount > 0
                              ? styles.headingUnread
                              : null,
                          ]}
                        >
                          {section.label}
                        </Text>
                        {section.collapsed && section.addressed ? (
                          <UnreadBadge
                            unreadCount={section.addressedCount}
                            mentionCount={section.mentionCount}
                          />
                        ) : null}
                        {/* Drawn, at the right edge where a thumb expects
                            it; the typed ▸ ▾ sat low and read as noise. */}
                        <DisclosureGlyph
                          color={tokens.color.text.mutedForeground}
                          size={18}
                          direction={section.collapsed ? "right" : "down"}
                        />
                      </PressableRow>
                      {/* Outside the fold control, so a screen reader
                          reaches it as its own button. */}
                      {index === 0 ? filterButton : null}
                    </View>
                  </StickyHeader>,
                  line || section.rows.length > 0 ? (
                    <View
                      key={`${section.key}:rows`}
                      // The first-run tour's first stop: the top section.
                      ref={index === 0 ? channelsAnchor : undefined}
                      collapsable={false}
                      style={[styles.section, styles.sectionRows]}
                    >
                      {line}
                      {section.rows.map(renderChannel)}
                    </View>
                  ) : null,
                ];
              })}

          {arranged.emptiedByFilters ? (
            <InlineNote
              action={{
                label: SHOW_ALL_CHANNELS_LABEL,
                onPress: () =>
                  setSidebarFilter({ unread_only: false, hide_muted: false }),
              }}
            >
              {NO_MATCHING_CHANNELS}
            </InlineNote>
          ) : null}
        </>
      )}

      <AskSheet ref={askSheetRef} />
      <StatusSheet ref={statusSheetRef} />
      <ChannelActionsMenu
        target={menuTarget}
        onClose={closeMenu}
        onAction={(key) => runMenuAction(key)}
        writeBlockedReason={writeBlockedReason}
        onSetDisplayLock={(channelId, locked) => {
          setDisplayLock
            .mutateAsync({ id: channelId, locked })
            .then(() => setChannelLocked(channelId, locked))
            .catch(() =>
              Alert.alert(
                "Couldn't change Always formal",
                "Nothing changed. Check your connection and try again.",
              ),
            );
        }}
        onSetBackground={(channelId, pick) => {
          void saveChatBackgroundPick(pick, {
            requestPhotoUrl: ({ filename, contentType }) =>
              requestBackgroundPhotoUrl.mutateAsync({
                scope: "channel",
                filename,
                contentType,
              }),
            save: ({ background, storagePath }) =>
              setChannelBackground.mutateAsync({
                channelId,
                background,
                storagePath,
              }),
          }).then((result) => {
            if (result.status === "refused") {
              Alert.alert("Couldn't change the background", result.reason);
            }
          });
        }}
        onSetLevel={(channelId, level) => {
          // Per call, not `mutate`'s per-call `onError`: TanStack runs that
          // only for the latest call, so a quick second change would swallow
          // the first one's failure.
          setNotificationLevel
            .mutateAsync({ channelId, level })
            .catch(() =>
              Alert.alert(
                "Couldn't change notifications",
                "Nothing changed. Check your connection and try again.",
              ),
            );
        }}
      />
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    section: {
      gap: tokens.spacing.xs,
    },
    // The rows under a pinned heading: the shell spaces its children by `md`,
    // and a heading sits `xs` above its own rows, as it did inside a section.
    sectionRows: {
      marginTop: tokens.spacing.xs - tokens.spacing.md,
    },
    // A section heading (2026-11-07): sentence case, a step above the rows'
    // caption and in their own brightness, so a Discord category's name reads
    // as a name. The old uppercase caption in the muted grey was the dimmest
    // thing on a dim screen.
    heading: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    headingUnread: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
    },
    // The fold header takes the rows' `gutterBleed`, so its name lines up
    // with the rows' sigils.
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...gutterBleed(tokens),
    },
    // Inside the fold control the label gives up width to the badge and the
    // chevron.
    headingInHeader: {
      flex: 1,
    },
    headingRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    headingGrow: {
      flex: 1,
    },
    // The same caption as a folding header, on the same row height, without
    // the chevron: nothing here folds.
    plainHeading: {
      flex: 1,
      marginBottom: 0,
      minHeight: tokens.touch.minimum,
      textAlignVertical: "center",
      lineHeight: tokens.touch.minimum,
    },
    filterLine: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      marginTop: -tokens.spacing.xs,
      marginBottom: tokens.spacing.xs,
    },
    filterLineText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    filterLineAction: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.foreground,
      textDecorationLine: "underline",
    },
    unreadWarning: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
    },
  });
}
