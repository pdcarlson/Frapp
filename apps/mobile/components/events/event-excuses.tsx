import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  errorCopy,
  canDecideExcuse,
  excuseSummaryLine,
  myExcuseView,
  sortExcusesForReview,
  useDecideEventExcuse,
  useEventExcuses,
  useMyAttendance,
  useMyEventExcuse,
  useSendEventExcuse,
  useWithdrawEventExcuse,
  type EventExcuseWithMember,
} from "@repo/hooks";
import { EVENT_EXCUSE_REASON_MAX, statusLabel } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetPrimaryButton,
  sheetFieldStyles,
} from "@/components/sheet-scaffold";
import { StatusChip } from "@/components/status-chip";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useConnection } from "@/lib/connection/use-connection";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Absence excuses on the event page (`spec/behavior/events.md` § Excuses,
 * #3735). Two blocks:
 *
 * - {@link MyExcuseCard}, for the member the event requires: **Can't make
 *   it** opens one line in place ("Exam review"), and after sending the card
 *   says where it went ("Excuse sent to Jake", or "to the officers" when the
 *   event has no creator to name) and then the decision. Calendar apps put
 *   "can't go, with a note" on the event itself (Google Calendar's Decline
 *   with a note, Outlook's Decline with a message), which is where a member
 *   who can't come already looks.
 * - {@link ExcuseReviewSection}, for whoever decides: the event's creator or
 *   an `events:update` holder. Pending excuses first, each with Approve and
 *   Decline, as a leave request reads in Slack's or Teams' approvals.
 *
 * What each offers is `myExcuseView`'s rule in `@repo/hooks`, which web's
 * event sheet reads too; the server enforces it either way. The writes have
 * no outbox, so they are disabled while a write would be lost.
 */
export function MyExcuseCard({
  eventId,
  required,
  start,
  end,
  opensMinutes,
  now,
  startWriting = false,
}: {
  eventId: string;
  required: boolean;
  start: string;
  end: string;
  opensMinutes: number;
  now: Date;
  /** Open the line on arrival: the chat card's Can't make it (#4660). */
  startWriting?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const field = sheetFieldStyles(tokens, accent);
  const { writeBlockedReason } = useConnection();

  // Read only for an event that requires the viewer: nobody else can have
  // sent one, so a member at an optional event costs no request.
  const mine = useMyEventExcuse(eventId, { enabled: required });
  const own = useMyAttendance(eventId);
  const send = useSendEventExcuse();
  const withdraw = useWithdrawEventExcuse();
  const [writing, setWriting] = useState(startWriting);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const view = myExcuseView({
    required,
    mine: mine.data,
    mineUnanswered: mine.data === undefined,
    ownAttendance: own.data,
    ownUnanswered: own.data === undefined,
    start,
    end,
    opensMinutes,
    now,
  });
  if (view.kind === "none") return null;

  const trimmed = reason.trim();
  const busy = send.isPending || withdraw.isPending;

  const submit = async () => {
    if (inFlight.current || !trimmed) return;
    inFlight.current = true;
    setError(null);
    try {
      await send.mutateAsync({ eventId, reason: trimmed });
      setWriting(false);
      setReason("");
    } catch (failure) {
      setError(
        errorCopy(failure, "Couldn't send your excuse. Try again.", {
          serverWritesForMembers: true,
        }),
      );
    } finally {
      inFlight.current = false;
    }
  };

  const takeBack = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      await withdraw.mutateAsync({ eventId });
    } catch (failure) {
      setError(
        errorCopy(failure, "Couldn't withdraw your excuse. Try again.", {
          serverWritesForMembers: true,
        }),
      );
    } finally {
      inFlight.current = false;
    }
  };

  if (view.kind === "offer") {
    return (
      <View style={styles.card} accessibilityLabel="Can't make it">
        {writing ? (
          <>
            <Text style={styles.title}>Can&apos;t make it</Text>
            <Text style={styles.caption}>
              Say why in one line. It goes to whoever runs this event.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Exam review, away game, sick…"
              placeholderTextColor={tokens.color.text.muted}
              maxLength={EVENT_EXCUSE_REASON_MAX}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
              accessibilityLabel="Reason"
              style={field.field}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <SheetPrimaryButton
              label="Send excuse"
              accent={accent}
              onAccent={tokens.color.gold.onHouse}
              onPress={() => void submit()}
              busy={send.isPending}
              disabled={!trimmed || busy || writeBlockedReason !== null}
              accessibilityHint={writeBlockedReason ?? undefined}
            />
            <TextAction
              label="Cancel"
              onPress={() => {
                setWriting(false);
                setError(null);
              }}
            />
          </>
        ) : (
          <TextAction
            label="Can't make it"
            hint="Send an excuse for this event."
            color={accent}
            onPress={() => setWriting(true)}
          />
        )}
      </View>
    );
  }

  const hue = excuseHue(tokens, view.status);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{view.title}</Text>
        <StatusChip label={statusLabel("eventExcuse", view.status)} hue={hue} />
      </View>
      <Text style={styles.reason}>“{view.reason}”</Text>
      {view.detail ? <Text style={styles.caption}>{view.detail}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {view.canWithdraw ? (
        <TextAction
          label={withdraw.isPending ? "Withdrawing…" : "Withdraw excuse"}
          color={accent}
          disabled={busy || writeBlockedReason !== null}
          hint={writeBlockedReason ?? undefined}
          onPress={() => void takeBack()}
        />
      ) : null}
    </View>
  );
}

/**
 * The receiver's list: "EXCUSES · 2 to decide · 12 excused", then each
 * excuse with the sender's name and reason. Mounted only for a viewer who
 * may decide (the event's creator or an `events:update` holder); any other
 * reader gets the route's 403, and the section then draws nothing.
 */
export function ExcuseReviewSection({
  eventId,
  viewerId,
  canUpdateEvents,
}: {
  eventId: string;
  viewerId: string | null;
  canUpdateEvents: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const excuses = useEventExcuses(eventId);
  const decide = useDecideEventExcuse();
  const { writeBlockedReason } = useConnection();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Two taps in one frame both see `deciding` unset; the ref doesn't.
  const inFlight = useRef(false);

  const rows = excuses.data ?? [];
  if (rows.length === 0) return null;

  const ordered = sortExcusesForReview(rows);
  const decider = { viewerId, canUpdateEvents };
  const summary = excuseSummaryLine(rows, decider);

  const run = async (
    row: EventExcuseWithMember,
    decision: "APPROVED" | "DECLINED",
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setDeciding(row.user_id);
    setError(null);
    try {
      await decide.mutateAsync({ eventId, userId: row.user_id, decision });
    } catch (failure) {
      setError(
        errorCopy(failure, "Couldn't save that decision. Try again.", {
          serverWritesForMembers: true,
        }),
      );
    } finally {
      inFlight.current = false;
      setDeciding(null);
    }
  };

  return (
    <View style={styles.section} accessibilityLabel="Excuses">
      <Text style={styles.sectionLabel}>
        {["Excuses", summary].filter(Boolean).join(" · ")}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {ordered.map((row) => {
        const name = row.display_name.trim() || "A member";
        // The creator's own excuse goes to the officers: shown, not decided.
        const decidable = canDecideExcuse(row, decider);
        const disabled = deciding !== null || writeBlockedReason !== null;
        return (
          <View key={row.id} style={styles.reviewRow}>
            <View style={styles.header}>
              <Text style={styles.title}>{name}</Text>
              {decidable ? null : (
                <StatusChip
                  label={statusLabel("eventExcuse", row.status)}
                  hue={excuseHue(tokens, row.status)}
                />
              )}
            </View>
            <Text style={styles.reason}>“{row.reason}”</Text>
            {decidable ? (
              <View style={styles.decisionRow}>
                <DecisionButton
                  label={deciding === row.user_id ? "Saving…" : "Approve"}
                  primary
                  disabled={disabled}
                  hint={writeBlockedReason ?? `Excuse ${name}.`}
                  onPress={() => void run(row, "APPROVED")}
                />
                <DecisionButton
                  label="Decline"
                  disabled={disabled}
                  hint={writeBlockedReason ?? `Keep ${name} required.`}
                  onPress={() => void run(row, "DECLINED")}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** An excuse status's semantic hue; a status a newer API adds reads muted. */
function excuseHue(tokens: SignetTokens, status: string): string {
  switch (status) {
    case "APPROVED":
      return tokens.color.semantic.success;
    case "DECLINED":
      return tokens.color.semantic.destructive;
    case "PENDING":
      return tokens.color.semantic.warning;
    default:
      return tokens.color.text.muted;
  }
}

function TextAction({
  label,
  onPress,
  color,
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textAction,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[
          styles.textActionLabel,
          { color: color ?? tokens.color.text.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DecisionButton({
  label,
  onPress,
  primary = false,
  disabled,
  hint,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled: boolean;
  hint: string;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.decision,
        primary ? { backgroundColor: accent, borderColor: accent } : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[
          styles.decisionLabel,
          primary ? { color: tokens.color.gold.onHouse } : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    title: {
      flex: 1,
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    reason: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.body),
    },
    caption: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    error: {
      color: tokens.color.semantic.destructiveText,
      ...typeRole(tokens.typography.role.caption),
    },
    textAction: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    textActionLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.5,
    },
    section: {
      gap: tokens.spacing.sm,
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    reviewRow: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    decisionRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    decision: {
      flex: 1,
      minHeight: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
      alignItems: "center",
      justifyContent: "center",
    },
    decisionLabel: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
  });
}
