import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
import { useChapterBranding, type ChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useCurrentChapter, useNow } from "@repo/hooks";
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
 * resource (`usePoll`/`useVoteOnPoll` in `@repo/hooks`). Those hooks back
 * the standalone `/polls` dashboard page and its own `poll_votes` table;
 * `chat_messages.type='POLL'` rows they create default to `kind: 'text'`
 * (never set by `PollService.createPoll`) and so never reach this renderer.
 * The `/poll` slash command (`packages/chat-core/src/dispatch.ts`) is the
 * only thing that creates a `kind: 'poll'` message, and it votes through
 * `chat_message_actions`, not `poll_votes` — confirmed by reading both
 * paths before choosing which one to mirror.
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
}

export function PollCard(props: PollCardProps) {
  const { message, viewerId, isConfirmed, onVote, onOpenActions } = props;
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  // The chapter accent is the tally fill and the selected-option chip: a
  // poll's own vote is the viewer's content, and the engine's solid-fill pair
  // (accent-engine.md §8) is what a filled control takes.
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const payload = readPollPayload(message);
  const now = useNow();
  // A card vote is a Polls write, and the server refuses it while Polls is off
  // (#2993). The gate is mirrored here so the member sees that before tapping
  // (#3012). It reads the member view (`useCurrentChapter`'s
  // `enabled_modules`, as `app/(app)/study.tsx` does), never the officer-only
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

  const closesAt = parseInstant(payload.closes_at);
  const isClosed = closesAt ? closesAt.getTime() < now : false;
  const canVote = isConfirmed && !isClosed && pollsGate === "on";
  const gateReason = pollsGateReason(pollsGate, { isClosed, isConfirmed });

  const cast = (option: PollOption) => {
    if (!canVote) return;
    onVote(message.id, POLL_VOTE_ACTION_TYPE, { option_id: option.id });
  };

  return (
    <ChatCardShell
      {...props}
      header={
        <>
          <CardEyebrow label={`Poll${isClosed ? " · Closed" : ""}`} />
          <CardTitle>{payload.question}</CardTitle>
        </>
      }
    >
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
    </ChatCardShell>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    malformed: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
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
    retryText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
  });
}
