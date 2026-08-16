import { useMemo } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useChannelUnreadCounts,
  useChannels,
  useEvents,
  useTasks,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { AskPill } from "@/components/chat/ask-pill";
import { ChannelRow } from "@/components/chat/channel-row";
import { UpNextStrip } from "@/components/chat/up-next-strip";
import {
  displayChannelName,
  indexUnread,
  isDirectChannel,
  selectChannels,
  type ChannelSummary,
} from "@/lib/chat/channel-list";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s04 — Chat home. Chat is home, so this is the tab bar's `index` route.
 *
 * Three surfaces, top to bottom: the ✦ Ask pill in the header
 * (`navigation.md:53`), the UP NEXT pulse strip (`navigation.md:52`), then the
 * channel list with unread and mention badges.
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

  const channelsQuery = useChannels();
  const unreadQuery = useChannelUnreadCounts();
  const eventsQuery = useEvents();
  const tasksQuery = useTasks();

  const channels = useMemo(
    () => selectChannels(channelsQuery.data),
    [channelsQuery.data],
  );
  const unread = useMemo(
    () => indexUnread(unreadQuery.data ?? []),
    [unreadQuery.data],
  );

  const directChannels = channels.filter(isDirectChannel);
  const chapterChannels = channels.filter((c) => !isDirectChannel(c));

  function openChannel(channelId: string) {
    // Object form, because the route takes a param. Note this is invisible to
    // `lib/routes.spec.ts`'s literal scan — the `pathname:` matcher added
    // alongside this slice is what keeps it covered.
    router.push({ pathname: "/chat-thread", params: { channelId } });
  }

  function renderChannel(channel: ChannelSummary) {
    const counts = unread[channel.id];
    return (
      <ChannelRow
        key={channel.id}
        name={displayChannelName(channel)}
        isDirect={isDirectChannel(channel)}
        unreadCount={counts?.unread ?? 0}
        mentionCount={counts?.mentions ?? 0}
        onPress={() => openChannel(channel.id)}
      />
    );
  }

  return (
    <ScreenShell
      title="Chat"
      subtitle="Your chapter's channels and direct messages."
      headerAction={<AskPill />}
    >
      <UpNextStrip events={eventsQuery.data} tasks={tasksQuery.data} />

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
            ScrollView has no RefreshControl to pull, `refetchOnWindowFocus` is
            off, and nothing wires `onlineManager`, so `refetchOnReconnect` never
            fires either. Without this the first blip at launch would leave Chat
            home dead until a force-quit — and the copy would have named a
            pull-to-refresh that does not exist.
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
      ) : channels.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>No channels yet</Text>
          <Text style={styles.stateBody}>
            Channels your chapter creates will appear here.
          </Text>
        </View>
      ) : (
        <>
          {/*
            TODO-DESIGN: the Canvas draws a PINNED section above CHANNELS
            (canvas-screens.dc.html:135), but `ChatChannel` carries no pin or
            favourite field — there is no data behind it on either client. The
            nearest honest pattern is to render only the sections that exist;
            adding a pin is an API change, not a screen decision.
          */}
          {chapterChannels.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CHANNELS</Text>
              {chapterChannels.map(renderChannel)}
            </View>
          ) : null}

          {directChannels.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>DIRECT</Text>
              {directChannels.map(renderChannel)}
            </View>
          ) : null}
        </>
      )}
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
