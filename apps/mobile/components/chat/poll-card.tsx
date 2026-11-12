import { useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  CLOSE_POLL_LABEL,
  POLL_VOTE_ACTION_TYPE,
  canClosePoll,
  castPollVote,
  isPollCardClosed,
  pollCardEyebrow,
  pollCardFooter,
  pollChoiceHint,
  pollOptionPercent,
  pollsGateReason,
  readPollPayload,
  tallyPollVotes,
  type PendingPollPicks,
  type PollOption,
} from "@repo/chat-core/polls";
import { SignetTokens } from "@repo/theme/signet";
import { meterStyles } from "@/components/meter";
import { useChapterBranding, type ChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useMyPermissions, useNow } from "@repo/hooks";
import { can } from "@repo/validation";
import { usePollsGate } from "@/lib/chat/use-polls-gate";
import {
  CardEyebrow,
  CardTitle,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * #528 — mobile in-chat poll voting. Mirrors
 * `apps/web/components/chat/renderers/poll-card.tsx` (question + tappable
 * options pre-vote, bar tallies post-vote), with two differences:
 *
 * 1. **A card in the row, not a message body.** `thread-message-row.tsx` puts
 *    it inside `MessageRowFrame`, which draws the reply quote, the avatar and
 *    the author line every row has (a card always starts a run,
 *    `@repo/chat-core/grouping`). The rest of the chrome (delivery status,
 *    reactions, the actions long-press) is `ChatCardShell` in `chat-card.tsx`,
 *    the frame the event and task cards share, so a poll message keeps the
 *    same affordances every other mobile message kind has.
 * 2. **`PollOption`/`POLL_VOTE_ACTION_TYPE`/payload-reading/tallying come from
 *    `@repo/chat-core/polls`**, the one shared copy web's `poll-card.tsx`
 *    also reads from, so a future fix to vote-parsing or tallying only has
 *    one place to land. The types themselves are re-exported there from
 *    their canonical home, `@repo/chat-core/integrations` (the frozen wire
 *    contract: ADR-07's `action_type: "vote"` / `payload.option_id`).
 *
 * Voting itself is the generic inline-card-action mechanism (`actOnCard` in
 * `@repo/chat-core/chat-client`, wired through `useChatChannel`'s `act`) —
 * the same one reactions use — **not** the separate `/v1/polls` REST
 * resource and its own `poll_votes` table, which no client reads any more
 * (web's `/polls` page and its hooks were retired, #3871).
 * `chat_messages.type='POLL'` rows that resource creates default to `kind: 'text'`
 * (never set by `PollService.createPoll`) and so never reach this renderer.
 * A `kind: 'poll'` message is created only by web's `/poll` slash command
 * (`packages/chat-core/src/dispatch.ts`), web's New poll dialog (#3865) and
 * this app's New poll sheet (`new-poll-sheet.tsx`, #3701), all through `buildPollMessage` in
 * `@repo/chat-core/polls`, and it votes through `chat_message_actions`, not
 * `poll_votes` — confirmed by reading both paths before choosing which one
 * to mirror.
 */

/**
 * `onOpenActions` matters more here than on most cards: a poll's question and
 * options are member-authored text, so a poll from someone else is reportable
 * like any message (#2312 §2). The viewer's own poll gets it too, for Reply
 * and Delete (#2775).
 */
export interface PollCardProps extends ChatCardFrameProps {
  onVote: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  /**
   * Close poll on an open poll the viewer started, or on anyone's for a
   * `channels:manage` holder (#3794, #4046). The caller confirms
   * first (`confirmClosePoll`); the card only offers it (`canClosePoll`).
   */
  onClosePoll?: (messageId: string) => void;
}

export function PollCard(props: PollCardProps) {
  const { message, viewerId, isConfirmed, onVote, onClosePoll, onOpenActions } =
    props;
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  // The chapter accent is the tally fill and the selected-option chip: a
  // poll's own vote is the viewer's content, and the engine's solid-fill pair
  // (accent-engine.md §8) is what a filled control takes.
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const payload = useMemo(() => readPollPayload(message), [message]);
  const now = useNow();
  // A card vote is a Polls write, and the server refuses it while Polls is off
  // (#2993). The gate is mirrored here so the member sees that before tapping
  // (#3012), failing closed until the chapter read answers and saying whether
  // it is still running or needs a Retry (`usePollsGate`). The composer's +
  // reads the same chapter through `plusMenuModel`, which greys its Poll row
  // instead (`components/chat/use-composer-plus.tsx`).
  const { gate: pollsGate, recheck: recheckPolls } = usePollsGate();
  // A `channels:manage` holder may close anyone's poll, as its creator may
  // their own (#4046). Unknown until the read lands, which offers it to the
  // creator only.
  const canManageChannels = can(
    "channels:manage",
    useMyPermissions().data?.permissions,
  );

  const tally = useMemo(
    () => tallyPollVotes(message, payload?.options ?? [], viewerId),
    [message, payload, viewerId],
  );
  const pendingPicks = useRef<PendingPollPicks | null>(null);

  if (!payload) {
    return (
      <ChatCardShell
        {...props}
        header={
          <Text style={styles.malformed}>
            Malformed poll · {message.content}
          </Text>
        }
      />
    );
  }

  // Closed by its deadline or, early, by its creator or a moderator (#3794). The server row's
  // `payload.closed_at` arrives as a Realtime UPDATE, so every open card
  // redraws closed the moment the creator closes it.
  const isClosed = isPollCardClosed(payload, now);
  const showClose =
    !!onClosePoll &&
    canClosePoll(message, payload, viewerId, now, {
      pollsGate,
      canManageChannels,
    });
  const canVote = isConfirmed && !isClosed && pollsGate === "on";
  const gateReason = pollsGateReason(pollsGate, { isClosed, isConfirmed });
  const choiceHint = pollChoiceHint(payload, isClosed);

  const cast = (option: PollOption) => {
    if (!canVote) return;
    // A multi-choice card (#3793) adds or clears the tapped option and sends
    // the member's whole list in their one vote row.
    // Built on the member's last tap while its answer is still on the way
    // (`castPollVote`), so two quick taps on a multi-choice card keep both.
    onVote(
      message.id,
      POLL_VOTE_ACTION_TYPE,
      castPollVote(payload, tally.myVotes, pendingPicks, option.id),
    );
  };

  return (
    <ChatCardShell
      {...props}
      header={
        <>
          <CardEyebrow label={pollCardEyebrow(payload, now)} />
          <CardTitle>{payload.question}</CardTitle>
          {choiceHint ? <Text style={styles.hint}>{choiceHint}</Text> : null}
        </>
      }
    >
      <View style={styles.options}>
        {payload.options.map((option) => {
          const count = tally.byOption[option.id] ?? 0;
          const pct = pollOptionPercent(payload, tally, option.id);
          const isMyVote = tally.myVotes.includes(option.id);
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
        {pollCardFooter(payload, tally, canVote)}
      </Text>
      {showClose ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onClosePoll?.(message.id)}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>{CLOSE_POLL_LABEL}</Text>
        </Pressable>
      ) : null}
      {gateReason ? (
        <View style={styles.gateRow}>
          <Text style={styles.gateText}>{gateReason}</Text>
          {pollsGate === "error" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry checking whether polls are on"
              hitSlop={8}
              onPress={recheckPolls}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ChatCardShell>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    malformed: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
      ...meterStyles(tokens).track,
      marginTop: tokens.spacing.xs - 2,
    },
    meterFill: meterStyles(tokens).fill,
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
    retryText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
    closeButton: {
      alignSelf: "flex-start",
      marginTop: tokens.spacing.xs,
      paddingVertical: tokens.spacing.xs,
    },
    closeText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
  });
}
