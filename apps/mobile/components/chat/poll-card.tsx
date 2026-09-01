import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  POLL_VOTE_ACTION_TYPE,
  readPollPayload,
  tallyPollVotes,
  type PollOption,
} from "@repo/chat-core/polls";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useNow } from "@repo/hooks";
import { groupReactions, ReactionRow } from "./message-bubble";

/**
 * #528 — mobile in-chat poll voting. Mirrors
 * `apps/web/components/chat/renderers/poll-card.tsx` (question + tappable
 * options pre-vote, bar tallies post-vote), with two differences:
 *
 * 1. **Not sided.** Web's `MessageRenderer` routes `kind: "poll"` to a card
 *    outside the bubble/avatar layout entirely (`rendersAsBubble` excludes
 *    every card kind); `chat-thread.tsx` does the same — this component is
 *    rendered directly by the list, not wrapped in `MessageBubble`. Web still
 *    gets retry/discard/reactions on a card row from the shared `MessageItem`
 *    wrapper every kind renders inside; mobile has no such wrapper, so this
 *    card renders that chrome itself — status text + Retry/Discard sourced
 *    from `message._status`/`_error` (mirroring `MineMessageBubble`), and
 *    `ReactionRow` imported from `message-bubble.tsx` rather than
 *    reimplemented, so a poll message keeps the same affordances every other
 *    mobile message kind has.
 * 2. **`PollOption`/`POLL_VOTE_ACTION_TYPE`/payload-reading/tallying come from
 *    `@repo/chat-core/polls`**, not `@repo/chat-integrations` (the type
 *    definitions' canonical home, `packages/chat-integrations/src/
 *    payloads.ts`). `apps/mobile/lib/chat/use-chat-channel.ts`'s own doc
 *    comment names why `chat-integrations` itself is off-limits: that
 *    package's `exports` map points `require` at an unbuilt `dist/` (#989),
 *    which is the condition Metro's resolver uses. `chat-core/polls` mirrors
 *    the frozen wire contract (ADR-07's `action_type: "vote"` /
 *    `payload.option_id`) locally rather than importing it, for the same
 *    reason — but as the *one* shared copy web's `poll-card.tsx` also reads
 *    from, not a second mobile-local one, so a future fix to vote-parsing or
 *    tallying only has one place to land.
 *
 * Voting itself is the generic inline-card-action mechanism (`actOnCard` in
 * `@repo/chat-core/chat-client`, wired through `useChatChannel`'s `act`) —
 * the same one reactions use — **not** the separate `/v1/polls` REST
 * resource (`usePoll`/`useVoteOnPoll` in `@repo/hooks`). Those hooks back
 * the standalone `/polls` dashboard page and its own `poll_votes` table;
 * `chat_messages.type='POLL'` rows they create default to `kind: 'text'`
 * (never set by `PollService.createPoll`) and so never reach this renderer.
 * The `/poll` slash command (`packages/chat-core/src/dispatch.ts`) is the
 * only thing that creates a `kind: 'poll'` message, and it votes through
 * `chat_message_actions`, not `poll_votes` — confirmed by reading both
 * paths before choosing which one to mirror.
 */

export interface PollCardProps {
  message: ChatMessage;
  viewerId: string | null;
  /** Confirmed messages can be voted on; pending optimistic rows cannot. */
  isConfirmed: boolean;
  onVote: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
}

export function PollCard({
  message,
  viewerId,
  isConfirmed,
  onVote,
  onRetry,
  onDiscard,
  onReact,
  onUnreact,
}: PollCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // The chapter accent is the tally fill and the selected-option chip, the
  // same identity signal `MineMessageBubble` gives the self bubble
  // (components.md:210) — a poll's own vote is the viewer's content too.
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const payload = readPollPayload(message);
  const now = useNow();
  const reactions = groupReactions(message, viewerId);

  const {
    byOption,
    total,
    myVote: viewerVote,
  } = useMemo(() => {
    if (!payload) return { byOption: {}, total: 0, myVote: null };
    return tallyPollVotes(message, payload.options, viewerId);
  }, [message, payload, viewerId]);

  // Sourced straight off `message._status`/`_error`, the same fields
  // `MineMessageBubble` reads — a poll message is optimistic/failed under
  // exactly the same `sendMessage` contract any other kind is.
  const isPending = message._status === "pending";
  const isFailed = message._status === "failed";
  const statusAndActions = isPending ? (
    <Text style={styles.metaText}>Sending…</Text>
  ) : isFailed ? (
    <View style={styles.failedRow}>
      <Text style={styles.metaFailed}>{message._error ?? "Send failed"}</Text>
      <View style={styles.failedActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry sending this message"
          hitSlop={8}
          onPress={() => onRetry(message.client_message_id)}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard this message"
          hitSlop={8}
          onPress={() => onDiscard(message.client_message_id)}
        >
          <Text style={styles.discardText}>Discard</Text>
        </Pressable>
      </View>
    </View>
  ) : null;
  const reactionRow = (
    <ReactionRow
      reactions={reactions}
      messageId={message.id}
      disabled={!isConfirmed}
      onReact={onReact}
      onUnreact={onUnreact}
      styles={styles}
      align="flex-start"
    />
  );

  if (!payload) {
    return (
      <View style={styles.card}>
        <Text style={styles.malformed}>Malformed poll · {message.content}</Text>
        {statusAndActions}
        {reactionRow}
      </View>
    );
  }

  const closesAt = payload.closes_at ? new Date(payload.closes_at) : null;
  const isClosed = closesAt
    ? !Number.isNaN(closesAt.getTime()) && closesAt.getTime() < now
    : false;
  const canVote = isConfirmed && !isClosed && viewerId !== null;

  const cast = (option: PollOption) => {
    if (!canVote) return;
    onVote(message.id, POLL_VOTE_ACTION_TYPE, { option_id: option.id });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Poll{isClosed ? " · Closed" : ""}</Text>
      <Text style={styles.question}>{payload.question}</Text>
      <View style={styles.options}>
        {payload.options.map((option) => {
          const count = byOption[option.id] ?? 0;
          const denom = total > 0 ? total : 1;
          const pct = total > 0 ? Math.round((count / denom) * 100) : 0;
          const isMyVote = viewerVote === option.id;
          return (
            <View key={option.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isMyVote, disabled: !canVote }}
                disabled={!canVote}
                onPress={() => cast(option)}
                style={[
                  styles.optionRow,
                  isMyVote
                    ? { backgroundColor: accentPrimary }
                    : styles.optionRowDefault,
                ]}
              >
                <Text
                  style={[
                    styles.optionLabel,
                    isMyVote ? { color: accentOnPrimary } : null,
                  ]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                <Text
                  style={[
                    styles.optionTally,
                    isMyVote ? { color: accentOnPrimary } : null,
                  ]}
                >
                  {count} · {pct}%
                </Text>
              </Pressable>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    { width: `${pct}%`, backgroundColor: accentPrimary },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.footer}>
        {total === 0
          ? `No votes yet${canVote ? " · be the first to vote" : ""}.`
          : `${total} vote${total === 1 ? "" : "s"}${viewerVote ? " · your vote is highlighted" : ""}`}
      </Text>
      {statusAndActions}
      {reactionRow}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      marginTop: tokens.spacing.xs,
      maxWidth: "86%",
      alignSelf: "flex-start",
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.surface.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    malformed: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    eyebrow: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    question: {
      ...typeRole(tokens.typography.role.body),
      fontWeight: "700",
      color: tokens.color.text.foreground,
      marginTop: tokens.spacing.xs,
    },
    options: {
      marginTop: tokens.spacing.sm + 1,
      gap: tokens.spacing.sm - 2,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md - 2,
      borderRadius: tokens.radius.control,
      minHeight: 44,
    },
    optionRowDefault: {
      backgroundColor: tokens.color.surface.popover,
    },
    optionLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    optionTally: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    meterTrack: {
      marginTop: tokens.spacing.xs - 2,
      height: 4,
      borderRadius: 2,
      backgroundColor: tokens.color.surface.background,
      overflow: "hidden",
    },
    meterFill: {
      height: "100%",
      borderRadius: 2,
    },
    footer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm + 1,
    },
    // Matches `MineMessageBubble`'s equivalent styles in message-bubble.tsx —
    // same failed/retry/discard treatment, since a poll message can be
    // pending or failed under the same `sendMessage` contract any other kind
    // is.
    metaText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.sm + 1,
    },
    failedRow: {
      marginTop: tokens.spacing.sm + 1,
      gap: tokens.spacing.xs,
    },
    metaFailed: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    failedActions: {
      flexDirection: "row",
      gap: tokens.spacing.md,
    },
    retryText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.askText,
    },
    discardText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    // Matches `MessageBubble`'s equivalent styles — `ReactionRow` (imported
    // from message-bubble.tsx) is narrowed to exactly these five keys.
    reactionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm - 2,
      marginTop: tokens.spacing.sm + 1,
    },
    reactionChip: {
      height: 26,
      paddingHorizontal: tokens.spacing.sm + 1,
      borderRadius: tokens.radius.chip + 1,
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    reactionChipMine: {
      backgroundColor: tokens.color.gold.askFill,
      borderWidth: 1,
      borderColor: tokens.color.gold.askBorder,
    },
    reactionText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    reactionTextMine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.gold.askText,
    },
  });
}
