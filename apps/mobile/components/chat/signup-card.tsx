import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { PendingPollPicks } from "@repo/chat-core/polls";
import {
  CLOSE_SIGNUP_LABEL,
  SIGNUP_CLAIM_ACTION_TYPE,
  canCloseSignup,
  canExportSignup,
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
  signupHoldersLine,
  signupSlotAction,
  signupSlotPercent,
  signupSlotSpoken,
  signupExportRows,
  signupSlotStatus,
  tallySignups,
} from "@repo/chat-core/signups";
import { cardExportFilenamePrefix } from "@repo/chat-core/form-responses";
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
import { fieldTypeRole, typeRole, useFrappTheme } from "@/lib/theme";
import { shareCsv } from "@/lib/chat/share-csv";
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
 *
 * A headcount (step 2) draws its two answers, Going and Can't make it, as
 * the same rows, with an optional note on the viewer's answer, shown after
 * their name. A closed card keeps its names and takes no taps; Close sign-ups
 * is its creator's or a `channels:manage` holder's, and so is Export (#3926
 * step 4), which shares the list as a CSV, as SignUpGenius reports give an
 * organizer theirs (`canExportSignup`, `signupExportRows`).
 */
export interface SignupCardProps extends ChatCardFrameProps {
  /** The row's roster lookup, for the names on each slot. */
  nameFor: NameResolver;
  onClaim: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  /** Close sign-ups; the caller confirms first (`confirmCloseCard`). */
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
  const [exporting, setExporting] = useState(false);

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
  const showExport =
    tally.people > 0 && canExportSignup(message, viewerId, canManageChannels);
  const deadline = signupDeadlineLine(payload, now);
  const exportList = async () => {
    if (exporting) return;
    setExporting(true);
    const ok = await shareCsv(
      signupExportRows(
        message,
        payload,
        (id) => actorLabel(id, nameFor) ?? "A member",
      ),
      cardExportFilenamePrefix("signup", payload.title),
      "Export sign-ups",
    );
    setExporting(false);
    if (!ok) Alert.alert("Couldn't export", "Try again in a moment.");
  };
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
          const percent = signupSlotPercent(slot, tally);
          const names = signupHoldersLine(
            holders,
            viewerId ?? null,
            (userId) => actorLabel(userId, nameFor) ?? "A member",
            3,
            tally.notes,
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
                  (action.full || closed) && !action.held
                    ? styles.slotRowFull
                    : null,
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
      {showExport || showClose ? (
        <View style={styles.links}>
          {showExport ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              accessibilityLabel="Export"
              accessibilityHint="Shares who signed up as a spreadsheet file."
              accessibilityState={{ disabled: exporting, busy: exporting }}
              disabled={exporting}
              onPress={() => void exportList()}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>
                {exporting ? "Exporting…" : "Export"}
              </Text>
            </Pressable>
          ) : null}
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
        </View>
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
    links: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: tokens.spacing.lg,
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
