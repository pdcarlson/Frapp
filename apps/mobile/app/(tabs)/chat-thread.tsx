import { useCallback, useMemo } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ChatMessage } from "@repo/chat-core/types";
import { useMarkChannelRead, useMemberDisplayNames } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PollCard } from "@/components/chat/poll-card";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { getKeyboardPath } from "@/lib/keyboard";
import { useConnection } from "@/lib/connection/use-connection";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s05 — Chat thread.
 *
 * **This screen deliberately does not use `ScreenShell`.** The shell wraps its
 * children in a `ScrollView` (`components/screen-shell.tsx:33`), and a
 * `FlatList` nested in a `ScrollView` loses windowing entirely — every message
 * ever loaded would mount at once, which is precisely the thing a thread cannot
 * afford. `app/(auth)/chapter-picker.tsx` is the existing precedent for opting
 * out. The shell is frozen, so this is a hand-rolled `SafeAreaView` instead of a
 * shell change.
 *
 * The list is **inverted**: `selectMessages` returns ascending order, so the
 * data is reversed once and `inverted` pins the newest message to the bottom
 * without a scroll-to-end effect racing every insert.
 *
 * Keyboard: `react-native-keyboard-controller` does not run in Expo Go, so it
 * lives behind `lib/keyboard.tsx`. This reads `getKeyboardPath()` only to pick
 * the right *behavior*, and uses `KeyboardAvoidingView` either way — the guarded
 * `KeyboardProvider` is already mounted app-wide, and a screen must never import
 * the native package directly (ESLint `no-restricted-imports` enforces it).
 */
export default function ChatThreadScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();

  // Params arrive as `string | string[]`; a repeated query key would otherwise
  // silently produce an array where a channel id is expected.
  const params = useLocalSearchParams<{ channelId?: string | string[] }>();
  const channelId = useMemo(() => {
    const raw = params.channelId;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.length > 0 ? value : null;
  }, [params.channelId]);

  const {
    messages,
    isLoading,
    loadError,
    viewerId,
    canSend,
    send,
    react,
    unreact,
    act,
    draft,
    setDraft,
    sendError,
    reactionError,
    clearReactionError,
    actionError,
    clearActionError,
    typingUsers,
    emitTyping,
    connection,
    retry,
    discard,
  } = useChatChannel(channelId);

  // One cached roster fetch per chapter names every author in the thread.
  // Resolving by `sender_id` is what makes it work for a message that arrived
  // over the live `postgres_changes` echo as well as one from the REST page — a
  // join on the message payload could only ever have covered the latter.
  const { nameFor } = useMemberDisplayNames();

  // Opening a channel stamps the read cursor to server `now()`; there is no
  // mark-read-to-a-message API. Its invalidation of `["channels"]` refreshes the
  // s04 badges by prefix.
  //
  // This is a **focus** effect, not a mount effect, and it stamps on the way out
  // as well as the way in. Both halves are load-bearing:
  //
  //  - `chat-thread` is a `Tabs.Screen`, so React Navigation keeps it mounted
  //    after first focus. A mount effect keyed on `channelId` would never re-run
  //    when the member leaves to Chat and taps the same channel again, leaving
  //    its badge stuck until they visited some *other* channel.
  //  - Messages arriving over realtime while the thread is open are read as they
  //    land, but the cursor was stamped before them. Stamping again on blur
  //    covers that burst in one request, where re-stamping per message would be
  //    one POST per message.
  const markRead = useMarkChannelRead();
  const markReadMutate = markRead.mutate;
  useFocusEffect(
    useCallback(() => {
      if (!channelId) return;
      markReadMutate(channelId);
      return () => markReadMutate(channelId);
    }, [channelId, markReadMutate]),
  );

  const handleChangeText = useCallback(
    (next: string) => {
      setDraft(next);
      // The manager throttles to one broadcast per 3s, so this can ride every
      // keystroke without flooding the channel.
      emitTyping();
    },
    [setDraft, emitTyping],
  );

  const handleSend = useCallback(() => {
    void send(draft);
  }, [send, draft]);

  // Inverted list wants newest first; the cache hands back oldest first.
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      // Cards render unsided, full-width — not wrapped in `MessageBubble` —
      // matching web's `rendersAsBubble` exclusion for every card kind.
      if (item.kind === "poll") {
        return (
          <PollCard
            message={item}
            viewerId={viewerId}
            isConfirmed={item._status === "confirmed"}
            onVote={(id, actionType, payload) =>
              void act(id, actionType, payload)
            }
          />
        );
      }
      return (
        <MessageBubble
          message={item}
          viewerId={viewerId}
          nameFor={nameFor}
          onRetry={(id) => void retry(id)}
          onDiscard={(id) => void discard(id)}
          onReact={(id, emoji) => void react(id, emoji)}
          onUnreact={(id, emoji) => void unreact(id, emoji)}
        />
      );
    },
    // `nameFor` belongs here: it changes identity when the roster resolves, and
    // omitting it leaves a stale closure rendering truncated ids until some
    // other dep happens to change.
    [viewerId, nameFor, retry, discard, react, unreact, act],
  );

  const isOffline = connection === "offline";
  const { isOffline: appOffline } = useConnection();

  /**
   * What the in-thread pill says, or `null` when it has nothing to add.
   *
   * `null` when the transport is live, and also when the transport is offline
   * while the global banner is already saying so — see the comment at the
   * render site.
   */
  const pillMessage =
    connection === "live"
      ? null
      : isOffline
        ? appOffline
          ? null
          : "Offline — messages will send when you reconnect"
        : connection === "polling"
          ? // Verbatim from spec/ui/resilience.md § 3.2, which declares this
            // string normative; `apps/web`'s reconnect pill carries the same
            // one. Polling is a working degraded mode, so calling it
            // "reconnecting" would report a live surface as broken.
            "Real-time updates paused. Polling for new messages."
          : "Reconnecting…";

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        // `padding` is the correct iOS behavior; on Android the window already
        // resizes. The keyboard path only differs in how precisely the inset is
        // tracked, not in which behavior is right.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        enabled={getKeyboardPath() === "fallback" || Platform.OS === "ios"}
      >
        {/*
          The rewrite dropped the old screen's "Back to chat overview" link, and
          a tab-registered route gets no header back button of its own — on iOS
          that left no way out but the Chat tab. The Canvas draws a `‹` here
          (s05, canvas-screens.dc.html:163), so this is the specced affordance
          rather than a reinstated stopgap.
        */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
            hitSlop={12}
            onPress={() => router.push("/")}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text style={styles.backChevron}>‹</Text>
          </Pressable>
          <Text numberOfLines={1} style={styles.headerTitle}>
            Thread
          </Text>
        </View>

        {/*
          Reconciled with the global banner rather than duplicating it (#998).
          The two answer different questions — this pill is the *realtime
          transport*, the banner is whether the API is reachable at all — but
          when both are saying "offline" they are one fact told twice, stacked
          on the same screen in two different sentences. So the pill yields its
          offline branch to the banner and keeps the two it alone can report.
          `polling` in particular must survive: it is a working degraded mode,
          and `spec/ui/resilience.md` § 3.2 declares its string normative.
        */}
        {pillMessage ? (
          <View style={styles.connectionPill}>
            <Text style={styles.connectionText}>{pillMessage}</Text>
          </View>
        ) : null}

        {!channelId ? (
          <View style={styles.stateBlock}>
            <Text style={styles.stateTitle}>No channel selected</Text>
            <Text style={styles.stateBody}>
              Open a channel from Chat to see its messages.
            </Text>
          </View>
        ) : isLoading ? (
          <View style={styles.stateBlock}>
            <ActivityIndicator color={tokens.color.text.muted} />
            <Text style={styles.stateBody}>Loading messages…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.stateBlock}>
            <Text style={styles.stateTitle}>Couldn&apos;t load messages</Text>
            <Text style={styles.stateBody}>{loadError.message}</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.stateBlock}>
            <Text style={styles.stateTitle}>No messages yet</Text>
            <Text style={styles.stateBody}>
              Say something to start the conversation.
            </Text>
          </View>
        ) : (
          <FlatList
            data={inverted}
            renderItem={renderItem}
            // `client_message_id` is always present and is stable across the
            // optimistic → confirmed transition, which the server id is not.
            keyExtractor={(item) => item.client_message_id}
            inverted
            contentContainerStyle={styles.listContent}
            style={styles.flex}
          />
        )}

        {typingUsers.length > 0 ? (
          <Text style={styles.typing}>
            {typingUsers.length === 1
              ? "Someone is typing…"
              : `${typingUsers.length} people are typing…`}
          </Text>
        ) : null}

        {/*
          react/unreact and inline card actions (poll votes, #528) have no
          failed-bubble equivalent to render inline — chat-core's rollback of
          the optimistic state is silent — so this banner is the only report
          of a rejected reaction or vote (#999). `reactionError` takes
          priority since the two can't fire from the same tap; dismissible
          because, unlike `sendError`, there is nothing to retry or discard.
        */}
        {reactionError || actionError ? (
          <View
            style={styles.reactionErrorBanner}
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.reactionErrorText}>
              {reactionError ?? actionError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              hitSlop={8}
              onPress={reactionError ? clearReactionError : clearActionError}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <Text style={styles.reactionErrorDismiss}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        {/*
          The composer stays enabled offline **on purpose**. `sendMessage`
          enqueues to the outbox and returns before it ever touches the network
          (`chat-client.ts` — "the row is safely queued; the reconnect flush
          will POST it"), and the runtime re-flushes on every reconnect. Gating
          the input on connectivity would make composing-while-offline
          impossible, which is the whole failure the outbox exists to prevent,
          and would contradict the banner directly above it.
        */}
        <ChatComposer
          value={draft}
          onChangeText={handleChangeText}
          onSend={handleSend}
          canSend={canSend}
          placeholder="Message"
          // A send that never reached the outbox has no failed bubble to show
          // (nothing was queued), so this line is the only report of it.
          //
          // The offline label is #501's "blocked **or clearly labeled**" half:
          // this surface has a queue, so it labels. `lib/connection/state.ts`
          // holds the rule for the surfaces that have to block instead.
          disabledHint={
            sendError ??
            // `canSend` first. It is false until `ctx` resolves, and
            // `ChatComposer` keys `editable` on it — so leading with the
            // offline branch promised "messages send when you reconnect" over
            // an input the member cannot type into, which is the one state
            // where nothing will be queued and nothing will send.
            (!canSend
              ? "Connecting to chat…"
              : appOffline
                ? "You're offline — messages send when you reconnect."
                : null)
          }
          hintTone={sendError ? "error" : "muted"}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    flex: {
      flex: 1,
    },
    listContent: {
      padding: tokens.spacing.lg,
      gap: tokens.spacing.lg,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    backChevron: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.gold.askText,
      minWidth: tokens.spacing.md,
    },
    headerTitle: {
      flex: 1,
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    pressed: {
      opacity: 0.6,
    },
    connectionPill: {
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.surface1,
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    connectionText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    typing: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    reactionErrorBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      backgroundColor: tokens.color.surface.surface1,
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    reactionErrorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      flex: 1,
    },
    reactionErrorDismiss: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    stateBlock: {
      flex: 1,
      gap: tokens.spacing.sm,
      alignItems: "center",
      justifyContent: "center",
      padding: tokens.spacing.xl,
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
