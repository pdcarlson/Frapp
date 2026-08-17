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
import { useMarkChannelRead } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import { getKeyboardPath } from "@/lib/keyboard";
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
    draft,
    setDraft,
    sendError,
    typingUsers,
    emitTyping,
    connection,
    retry,
    discard,
  } = useChatChannel(channelId);

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
    ({ item }: { item: ChatMessage }) => (
      <MessageBubble
        message={item}
        viewerId={viewerId}
        onRetry={(id) => void retry(id)}
        onDiscard={(id) => void discard(id)}
        onReact={(id, emoji) => void react(id, emoji)}
        onUnreact={(id, emoji) => void unreact(id, emoji)}
      />
    ),
    [viewerId, retry, discard, react, unreact],
  );

  const isOffline = connection === "offline";

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

        {connection !== "live" ? (
          <View style={styles.connectionPill}>
            <Text style={styles.connectionText}>
              {isOffline
                ? "Offline — messages will send when you reconnect"
                : connection === "polling"
                  ? // Verbatim from spec/ui/resilience.md § 3.2, which declares
                    // this string normative; `apps/web`'s reconnect pill carries
                    // the same one. Polling is a working degraded mode, so
                    // calling it "reconnecting" would report a live surface as
                    // broken.
                    "Real-time updates paused. Polling for new messages."
                  : "Reconnecting…"}
            </Text>
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
          disabledHint={sendError ?? (canSend ? null : "Connecting to chat…")}
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
