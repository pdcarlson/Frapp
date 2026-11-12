import { useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PendingPollPicks } from "@repo/chat-core/polls";
import {
  SIGNUP_CLAIM_ACTION_TYPE,
  castSignupClaim,
  readSignupPayload,
  signupCardEyebrow,
  signupCardFooter,
  signupHoldersLine,
  signupSlotAction,
  signupSlotPercent,
  signupSlotSpoken,
  signupSlotStatus,
  tallySignups,
} from "@repo/chat-core/signups";
import { actorLabel, type NameResolver } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  CardEyebrow,
  CardTitle,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * A sign-up sheet card (`kind: "signup"`, #3926), the phone's twin of web's
 * `apps/web/components/chat/renderers/signup-card.tsx`. Each slot is a row a
 * tap takes or gives up, drawn as the poll card draws an option (the
 * accent fill marks the viewer's own; a full one dims and says Full), with
 * a meter for a slot with a limit and who holds it named on one line under
 * it, as iMessage and Discord polls name voters. Reading,
 * counting, the words and the claim a tap sends are
 * `@repo/chat-core/signups`, so the two cards can't disagree. A tap goes
 * through the same `actOnCard` path a poll vote does; the API refuses one
 * that lost the last spot (409), which the channel's card-action error alert
 * shows. The frame (long-press actions, delivery status, reactions) is
 * `ChatCardShell`, as for every card.
 */
export interface SignupCardProps extends ChatCardFrameProps {
  /** The row's roster lookup, for the names on each slot. */
  nameFor: NameResolver;
  onClaim: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
}

export function SignupCard(props: SignupCardProps) {
  const { message, viewerId, isConfirmed, nameFor, onClaim, onOpenActions } =
    props;
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const payload = useMemo(() => readSignupPayload(message), [message]);
  const tally = useMemo(
    () => (payload ? tallySignups(message, payload, viewerId) : null),
    [message, payload, viewerId],
  );
  const pending = useRef<PendingPollPicks | null>(null);

  if (!payload || !tally) {
    return (
      <ChatCardShell
        {...props}
        header={
          <Text style={styles.muted}>
            Malformed sign-up · {message.content}
          </Text>
        }
      />
    );
  }

  const canClaim = isConfirmed && !!viewerId;
  const claim = (slotId: string) => {
    if (!canClaim) return;
    onClaim(
      message.id,
      SIGNUP_CLAIM_ACTION_TYPE,
      castSignupClaim(payload, tally, pending, slotId),
    );
  };

  return (
    <ChatCardShell
      {...props}
      header={
        <>
          <CardEyebrow label={signupCardEyebrow(payload, tally)} />
          <CardTitle>{payload.title}</CardTitle>
          {payload.note ? (
            <Text style={styles.note}>{payload.note}</Text>
          ) : null}
        </>
      }
    >
      <View style={styles.slots}>
        {payload.slots.map((slot) => {
          const action = signupSlotAction(slot, tally);
          const holders = tally.bySlot[slot.id] ?? [];
          const disabled = !canClaim || action.full;
          const percent = signupSlotPercent(slot, tally);
          const names = signupHoldersLine(
            holders,
            viewerId ?? null,
            (userId) => actorLabel(userId, nameFor) ?? "A member",
          );
          return (
            <View key={slot.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${action.label}: ${slot.label}`}
                accessibilityValue={{ text: signupSlotSpoken(slot, tally) }}
                accessibilityState={{ selected: action.held, disabled }}
                disabled={disabled}
                onPress={() => claim(slot.id)}
                // A slot is most of the card, as a poll option is: a long
                // press opens the card's actions, never a claim.
                onLongPress={onOpenActions}
                style={[
                  styles.slotRow,
                  action.held
                    ? { backgroundColor: brand.accentPrimary }
                    : styles.slotRowDefault,
                  action.full && !action.held ? styles.slotRowFull : null,
                ]}
              >
                <Text
                  style={[
                    styles.slotLabel,
                    action.held ? { color: brand.accentOnPrimary } : null,
                  ]}
                >
                  {slot.label}
                </Text>
                <Text
                  style={[
                    styles.count,
                    action.held ? { color: brand.accentOnPrimary } : null,
                  ]}
                >
                  {signupSlotStatus(slot, tally)}
                </Text>
              </Pressable>
              {percent !== null ? (
                <View style={styles.meterTrack}>
                  <View
                    style={[
                      styles.meterFill,
                      {
                        width: `${percent}%`,
                        backgroundColor: brand.accentPrimary,
                      },
                    ]}
                  />
                </View>
              ) : null}
              {names ? (
                <Text style={styles.names} numberOfLines={2}>
                  {names}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={styles.footer}>{signupCardFooter(payload, tally)}</Text>
    </ChatCardShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    muted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    slots: {
      marginTop: tokens.spacing.sm + 1,
      gap: tokens.spacing.sm - 2,
    },
    // The poll card's option row (`poll-card.tsx`): a sign-up is the same
    // family of card, a list of choices a tap takes.
    slotRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md - 2,
      borderRadius: tokens.radius.control,
      minHeight: 44,
    },
    slotRowDefault: {
      backgroundColor: tokens.color.surface.popover,
    },
    slotRowFull: {
      opacity: 0.55,
    },
    slotLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    count: {
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
    names: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs - 2,
      paddingHorizontal: tokens.spacing.xs,
    },
    footer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm + 1,
    },
  });
}
