import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useNow } from "@repo/hooks";

/**
 * #528 — mobile in-chat poll voting. Mirrors
 * `apps/web/components/chat/renderers/poll-card.tsx` (question + tappable
 * options pre-vote, bar tallies post-vote), with two differences:
 *
 * 1. **Not sided.** Web's `MessageRenderer` routes `kind: "poll"` to a card
 *    outside the bubble/avatar layout entirely (`rendersAsBubble` excludes
 *    every card kind); `chat-thread.tsx` does the same — this component is
 *    rendered directly by the list, not wrapped in `MessageBubble`.
 * 2. **`PollPayload`/`PollOption`/`POLL_VOTE_ACTION_TYPE` are redeclared here**
 *    rather than imported from `@repo/chat-integrations` (the canonical home,
 *    `packages/chat-integrations/src/payloads.ts`). `apps/mobile/lib/chat/
 *    use-chat-channel.ts`'s own doc comment names why: that package's
 *    `exports` map points `require` at an unbuilt `dist/` (#989), which is
 *    the condition Metro's resolver uses — so importing it from mobile is a
 *    real runtime risk, not a style preference. The shape is small and
 *    frozen by the wire contract (ADR-07's `action_type: "vote"` /
 *    `payload.option_id`), so duplicating it is safe.
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

interface PollOption {
  id: string;
  label: string;
}

interface PollPayload {
  question: string;
  options: PollOption[];
  closes_at: string;
}

/** Matches `POLL_VOTE_ACTION_TYPE` in `packages/chat-integrations/src/payloads.ts`. */
const POLL_VOTE_ACTION_TYPE = "vote";

function readPayload(message: ChatMessage): PollPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const question = (raw as { question?: unknown }).question;
  const options = (raw as { options?: unknown }).options;
  const closesAt = (raw as { closes_at?: unknown }).closes_at;
  if (typeof question !== "string" || !Array.isArray(options)) return null;
  const parsed: PollOption[] = [];
  for (const o of options) {
    if (!o || typeof o !== "object") continue;
    const id = (o as { id?: unknown }).id;
    const label = (o as { label?: unknown }).label;
    if (typeof id === "string" && typeof label === "string") {
      parsed.push({ id, label });
    }
  }
  if (parsed.length < 2) return null;
  return {
    question,
    options: parsed,
    closes_at: typeof closesAt === "string" ? closesAt : "",
  };
}

/** Identical tally logic to web's `tallyByOption`, kept in sync by inspection. */
function tallyByOption(
  message: ChatMessage,
  options: PollOption[],
  viewerId: string | null,
): { byOption: Record<string, number>; total: number; myVote: string | null } {
  const byOption: Record<string, number> = {};
  for (const o of options) byOption[o.id] = 0;
  let total = 0;
  let myVote: string | null = null;
  for (const action of message.actions) {
    if (action.action_type !== POLL_VOTE_ACTION_TYPE) continue;
    const optionId = (action.payload as { option_id?: unknown } | null)
      ?.option_id;
    if (typeof optionId !== "string" || !(optionId in byOption)) continue;
    byOption[optionId] = (byOption[optionId] ?? 0) + 1;
    total += 1;
    if (viewerId && action.user_id === viewerId) myVote = optionId;
  }
  return { byOption, total, myVote };
}

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
}

export function PollCard({
  message,
  viewerId,
  isConfirmed,
  onVote,
}: PollCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // The chapter accent is the tally fill and the selected-option chip, the
  // same identity signal `MineMessageBubble` gives the self bubble
  // (components.md:210) — a poll's own vote is the viewer's content too.
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const payload = readPayload(message);
  const now = useNow();

  const {
    byOption,
    total,
    myVote: viewerVote,
  } = useMemo(() => {
    if (!payload) return { byOption: {}, total: 0, myVote: null };
    return tallyByOption(message, payload.options, viewerId);
  }, [message, payload, viewerId]);

  if (!payload) {
    return (
      <View style={styles.card}>
        <Text style={styles.malformed}>Malformed poll · {message.content}</Text>
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
  });
}
