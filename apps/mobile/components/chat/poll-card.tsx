import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  POLL_VOTE_ACTION_TYPE,
  pollsGateOf,
  pollsGateReason,
  readPollPayload,
  tallyPollVotes,
  type PollOption,
} from "@repo/chat-core/polls";
import { parseInstant } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { isModuleEnabled } from "@repo/validation";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  deliveryChrome,
  type DeliveryChrome,
} from "@/lib/chat/delivery-status";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useCurrentChapter, useNow } from "@repo/hooks";
import {
  groupReactions,
  messageActionsA11yProps,
  ReactionRow,
} from "./message-item";

/**
 * #528 — mobile in-chat poll voting. Mirrors
 * `apps/web/components/chat/renderers/poll-card.tsx` (question + tappable
 * options pre-vote, bar tallies post-vote), with two differences:
 *
 * 1. **A card in the row, not a message body.** `thread-message-row.tsx` puts
 *    it inside `MessageRowFrame`, which draws the reply quote, the avatar and
 *    the author line every row has (a card always starts a run,
 *    `@repo/chat-core/grouping`). The card itself renders the rest of the
 *    chrome — status text + Retry/Discard sourced from
 *    `message._status`/`_error` via exhaustive `deliveryChrome` (#1910), and
 *    `ReactionRow` imported from `message-item.tsx` rather than
 *    reimplemented, so a poll message keeps the same affordances every other
 *    mobile message kind has. `unconfirmed`/`recorded` are a muted note with
 *    no Discard; mobile has no slash replay path, so they are read-only.
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
  viewerId: string;
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
  /**
   * Opens the message actions sheet — the same one `MessageItem` uses. A
   * poll's question and options are member-authored text, so a poll from
   * someone else is reportable like any message (#2312 §2). The viewer's own
   * poll gets it too, for Reply and Delete (#2775); which rows the sheet shows
   * is decided by `messageActionsFor`, not by whether this is passed.
   */
  onOpenActions?: () => void;
  /**
   * Scrolls to the parent when this poll is a reply whose parent is shown.
   * The quote above the row is tappable; this is its screen-reader twin on the
   * card's own accessible container, as a text reply has on its body.
   */
  onJumpToParent?: () => void;
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
  onOpenActions,
  onJumpToParent,
}: PollCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // The chapter accent is the tally fill and the selected-option chip: a
  // poll's own vote is the viewer's content, and the engine's solid-fill pair
  // (accent-engine.md §8) is what a filled control takes.
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const payload = readPollPayload(message);
  const now = useNow();
  const reactions = groupReactions(message, viewerId);
  // A card vote is a Polls write, and the server refuses it while Polls is off
  // (#2993). The gate is mirrored here so the member sees that before tapping
  // (#3012). It reads the member view (`useCurrentChapter`'s
  // `enabled_modules`, as `app/(tabs)/study.tsx` does), never the officer-only
  // config, and fails closed until that read answers, saying whether it is
  // still running or needs a Retry (`pollsGateOf`, shared with web). A missing
  // `polls` key is on.
  const chapterQuery = useCurrentChapter();
  const pollsGate = pollsGateOf({
    pollsEnabled:
      chapterQuery.data === undefined
        ? undefined
        : isModuleEnabled(chapterQuery.data?.enabled_modules, "polls"),
    fetchStatus: chapterQuery.fetchStatus,
  });

  const {
    byOption,
    total,
    myVote: viewerVote,
  } = useMemo(() => {
    if (!payload) return { byOption: {}, total: 0, myVote: null };
    return tallyPollVotes(message, payload.options, viewerId);
  }, [message, payload, viewerId]);

  // Sourced straight off `message._status`/`_error` through `deliveryChrome`
  // — a poll message is optimistic/failed/unconfirmed under exactly the
  // same `sendMessage` contract any other kind is. The switch is exhaustive
  // so a new `MessageStatus` cannot render as a fully-sent poll (#1910).
  const statusAndActions = (
    <PollDeliveryChrome
      chrome={deliveryChrome(message)}
      styles={styles}
      clientMessageId={message.client_message_id}
      onRetry={onRetry}
      onDiscard={onDiscard}
    />
  );
  const reactionRow = (
    <ReactionRow
      reactions={reactions}
      messageId={message.id}
      disabled={!isConfirmed}
      onReact={onReact}
      onUnreact={onUnreact}
      onLongPress={onOpenActions}
      styles={styles}
    />
  );

  // Same shape as `MessageItem`'s row: the gesture on a wrapper that
  // is not itself an accessibility element (so the option buttons stay
  // reachable), and the screen-reader action on an accessible `View` around
  // the card's own text — never on a bare `Text` (see
  // `messageActionsA11yProps`).
  const a11yActions = messageActionsA11yProps(onOpenActions, {
    onJumpToParent,
  });
  const hasActions = "accessibilityActions" in a11yActions;

  if (!payload) {
    return (
      <Pressable
        accessible={false}
        onLongPress={onOpenActions}
        disabled={!onOpenActions}
        style={styles.card}
      >
        <View accessible={hasActions} {...a11yActions}>
          <Text style={styles.malformed}>
            Malformed poll · {message.content}
          </Text>
        </View>
        {statusAndActions}
        {reactionRow}
      </Pressable>
    );
  }

  const closesAt = parseInstant(payload.closes_at);
  const isClosed = closesAt ? closesAt.getTime() < now : false;
  const canVote = isConfirmed && !isClosed && pollsGate === "on";
  const gateReason = pollsGateReason(pollsGate, { isClosed, isConfirmed });

  const cast = (option: PollOption) => {
    if (!canVote) return;
    onVote(message.id, POLL_VOTE_ACTION_TYPE, { option_id: option.id });
  };

  return (
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      disabled={!onOpenActions}
      style={styles.card}
    >
      <View accessible={hasActions} {...a11yActions}>
        <Text style={styles.eyebrow}>Poll{isClosed ? " · Closed" : ""}</Text>
        <Text style={styles.question}>{payload.question}</Text>
      </View>
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
                accessibilityHint={gateReason ?? undefined}
                disabled={!canVote}
                onPress={() => cast(option)}
                // An option is most of the card's area. Without this a long
                // press on one would end as a plain press — a vote — instead of
                // opening the actions the rest of the card opens.
                onLongPress={onOpenActions}
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
      {gateReason ? (
        <View style={styles.gateRow}>
          <Text style={styles.gateText}>{gateReason}</Text>
          {pollsGate === "error" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry checking whether polls are on"
              hitSlop={8}
              onPress={() => void chapterQuery.refetch()}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {statusAndActions}
      {reactionRow}
    </Pressable>
  );
}

/**
 * Poll-row delivery chrome. Exhaustive over `DeliveryChrome` so a new
 * `MessageStatus` cannot render as a fully-sent poll (the old `else` was
 * `null`, which is the delivered look).
 *
 * Retry/Discard stay on `failed` only. `unconfirmed` is a muted note with
 * no control — mobile has no slash replay path, and discard is never safe.
 */
function PollDeliveryChrome({
  chrome,
  styles,
  clientMessageId,
  onRetry,
  onDiscard,
}: {
  chrome: DeliveryChrome;
  styles: ReturnType<typeof createStyles>;
  clientMessageId: string;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}) {
  switch (chrome.status) {
    case "pending":
      return <Text style={styles.metaText}>Sending…</Text>;
    case "failed":
      return (
        <View style={styles.failedRow}>
          <Text style={styles.metaFailed}>{chrome.error}</Text>
          <View style={styles.failedActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry sending this message"
              hitSlop={8}
              onPress={() => onRetry(clientMessageId)}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard this message"
              hitSlop={8}
              onPress={() => onDiscard(clientMessageId)}
            >
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      );
    case "unconfirmed":
    case "recorded":
      return (
        <Text style={styles.metaText} accessibilityLiveRegion="polite">
          {chrome.note}
        </Text>
      );
    case "confirmed":
      return null;
    default: {
      const _never: never = chrome;
      return _never;
    }
  }
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The body column's full width: a card in the row, under its author line.
    card: {
      marginTop: tokens.spacing.xs,
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
    gateRow: {
      marginTop: tokens.spacing.xs,
      gap: tokens.spacing.xs,
    },
    gateText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // Matches `MessageItem`'s delivery line in message-item.tsx — same
    // pending/failed/unconfirmed/recorded treatment, since a poll message
    // shares the `sendMessage` contract any other kind is.
    metaText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
      color: tokens.color.text.mutedForeground,
    },
    // Matches `MessageItem`'s equivalent styles — `ReactionRow` (imported
    // from message-item.tsx) is narrowed to exactly these five keys.
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
