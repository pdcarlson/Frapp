import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { PendingPollPicks } from "@repo/chat-core/polls";
import {
  CLOSE_SIGNUP_LABEL,
  SIGNUP_CLAIM_ACTION_TYPE,
  canCloseSignup,
  castSignupClaim,
  headcountAnswerPayload,
  headcountNotePayload,
  type PendingHeadcount,
  isHeadcountSignup,
  isSignupClosed,
  readSignupPayload,
  signupDeadlineLine,
  signupCardEyebrow,
  signupCardFooter,
  signupSlotAction,
  signupSlotCount,
  tallySignups,
} from "@repo/chat-core/signups";
import {
  actorLabel,
  useMyPermissions,
  useNow,
  type NameResolver,
} from "@repo/hooks";
import { can, SIGNUP_ANSWER_NOTE_MAX_LENGTH } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { fieldTypeRole, tint, typeRole, useFrappTheme } from "@/lib/theme";
import {
  CardEyebrow,
  CardTitle,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * A sign-up sheet card (`kind: "signup"`, #3926), the phone's twin of web's
 * `apps/web/components/chat/renderers/signup-card.tsx`: each slot's name, how
 * full it is, who holds it, and a Sign up / Signed up button. Reading,
 * counting, the words and the claim a tap sends are
 * `@repo/chat-core/signups`, so the two cards can't disagree. A tap goes
 * through the same `actOnCard` path a poll vote does; the API refuses one
 * that lost the last spot (409), which the channel's card-action error alert
 * shows. The frame (long-press actions, delivery status, reactions) is
 * `ChatCardShell`, as for every card.
 *
 * A headcount (step 2) draws its two answers, Going and Can't make it, the
 * same way, with an optional note on the viewer's answer. A closed card keeps
 * its names and takes no taps; Close sign-ups is its creator's or a
 * `channels:manage` holder's.
 */
export interface SignupCardProps extends ChatCardFrameProps {
  /** The row's roster lookup, for the names on each slot. */
  nameFor: NameResolver;
  onClaim: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  /** Close sign-ups; the caller confirms first (`confirmCloseSignup`). */
  onCloseSignup?: (messageId: string) => void;
}

export function SignupCard(props: SignupCardProps) {
  const {
    message,
    viewerId,
    isConfirmed,
    nameFor,
    onClaim,
    onCloseSignup,
    onOpenActions,
  } = props;
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const payload = useMemo(() => readSignupPayload(message), [message]);
  const tally = useMemo(
    () => (payload ? tallySignups(message, payload, viewerId) : null),
    [message, payload, viewerId],
  );
  const pending = useRef<PendingPollPicks | null>(null);
  // The last headcount tap, until the card catches up (`PendingHeadcount`).
  const pendingAnswer = useRef<PendingHeadcount | null>(null);
  const now = useNow();
  const canManageChannels = can(
    "channels:manage",
    useMyPermissions().data?.permissions,
  );
  // The note being typed, or `null` while the field is shut.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

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

  const closed = isSignupClosed(payload, now);
  const headcount = isHeadcountSignup(payload);
  const canClaim = isConfirmed && !!viewerId && !closed;
  const showClose =
    !!onCloseSignup &&
    canCloseSignup(message, payload, viewerId, now, canManageChannels);
  const deadline = signupDeadlineLine(payload, now);
  const myNote = viewerId ? (tally.notes[viewerId] ?? "") : "";
  const claim = (slotId: string) => {
    if (!canClaim) return;
    onClaim(
      message.id,
      SIGNUP_CLAIM_ACTION_TYPE,
      headcount
        ? headcountAnswerPayload(tally, viewerId, pendingAnswer, slotId)
        : castSignupClaim(payload, tally, pending, slotId),
    );
  };
  const saveNote = () => {
    if (noteDraft === null) return;
    const next = headcountNotePayload(
      tally,
      viewerId,
      pendingAnswer,
      noteDraft,
    );
    setNoteDraft(null);
    if (!canClaim || !next) return;
    onClaim(message.id, SIGNUP_CLAIM_ACTION_TYPE, next);
  };

  return (
    <ChatCardShell
      {...props}
      header={
        <>
          <CardEyebrow label={signupCardEyebrow(payload, tally, now)} />
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
          return (
            <View
              key={slot.id}
              style={[styles.slot, action.held ? styles.slotHeld : null]}
            >
              <View style={styles.slotRow}>
                <Text style={styles.slotLabel}>{slot.label}</Text>
                <Text
                  style={styles.count}
                  accessibilityLabel={
                    slot.capacity === null
                      ? `${holders.length} signed up`
                      : `${holders.length} of ${slot.capacity} spots taken`
                  }
                >
                  {signupSlotCount(slot, tally)}
                </Text>
                {closed && !action.held ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${action.label}: ${slot.label}`}
                    accessibilityState={{ selected: action.held, disabled }}
                    disabled={disabled}
                    hitSlop={6}
                    onPress={() => claim(slot.id)}
                    onLongPress={onOpenActions}
                    style={[
                      styles.button,
                      action.held
                        ? {
                            backgroundColor: brand.accentPrimary,
                            borderColor: brand.accentPrimary,
                          }
                        : null,
                      disabled && !action.held ? styles.buttonDisabled : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        action.held ? { color: brand.accentOnPrimary } : null,
                        disabled && !action.held
                          ? styles.buttonTextDisabled
                          : null,
                      ]}
                    >
                      {action.held ? `${action.label} ✓` : action.label}
                    </Text>
                  </Pressable>
                )}
              </View>
              {holders.length > 0 ? (
                <View style={styles.people}>
                  {holders.map((userId) => {
                    const mine = userId === viewerId;
                    return (
                      <View
                        key={userId}
                        style={[styles.chip, mine ? styles.chipMine : null]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            mine ? styles.chipTextMine : null,
                          ]}
                          numberOfLines={1}
                        >
                          {mine
                            ? "You"
                            : (actorLabel(userId, nameFor) ?? "A member")}
                          {tally.notes[userId]
                            ? ` · ${tally.notes[userId]}`
                            : ""}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.empty}>
                  {headcount || slot.capacity !== null
                    ? "No one yet"
                    : "No limit · no one yet"}
                </Text>
              )}
            </View>
          );
        })}
      </View>
      {headcount && canClaim && tally.mine.length > 0 ? (
        noteDraft === null ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setNoteDraft(myNote)}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>
              {myNote ? "Edit your note" : "Add a note"}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.noteRow}>
            <TextInput
              autoFocus
              value={noteDraft}
              onChangeText={setNoteDraft}
              onSubmitEditing={saveNote}
              maxLength={SIGNUP_ANSWER_NOTE_MAX_LENGTH}
              placeholder="Running late, bringing a friend…"
              placeholderTextColor={tokens.color.text.mutedForeground}
              accessibilityLabel="Note on your answer"
              returnKeyType="done"
              style={styles.noteInput}
            />
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={saveNote}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Save</Text>
            </Pressable>
          </View>
        )
      ) : null}
      <Text style={styles.footer}>
        {signupCardFooter(payload, tally)}
        {deadline ? ` · ${deadline}` : ""}
      </Text>
      {showClose ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          accessibilityLabel={CLOSE_SIGNUP_LABEL}
          onPress={() => onCloseSignup?.(message.id)}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>{CLOSE_SIGNUP_LABEL}</Text>
        </Pressable>
      ) : null}
    </ChatCardShell>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
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
    slot: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.control,
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md - 2,
      gap: tokens.spacing.xs,
    },
    slotHeld: {
      borderColor: brand.accentPrimary,
      backgroundColor: tint(brand.accentPrimary),
    },
    slotRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: 36,
    },
    slotLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    count: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    button: {
      minHeight: 36,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md - 2,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
    buttonTextDisabled: {
      color: tokens.color.text.mutedForeground,
    },
    people: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.xs,
    },
    chip: {
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 2,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
      maxWidth: "100%",
    },
    chipMine: {
      backgroundColor: tint(brand.accentPrimary),
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    chipTextMine: {
      color: brand.accent,
    },
    empty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    footer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm + 1,
    },
    linkButton: {
      alignSelf: "flex-start",
      marginTop: tokens.spacing.xs,
      paddingVertical: tokens.spacing.xs,
    },
    linkText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
    noteRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.sm,
    },
    noteInput: {
      ...fieldTypeRole(tokens.typography.role.caption),
      flex: 1,
      minHeight: 36,
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
      color: tokens.color.text.foreground,
    },
  });
}
