import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  errorCopy,
  canDecideExcuse,
  excuseSummaryLine,
  myExcuseView,
  sortExcusesForReview,
  useDecideEventExcuse,
  useEditEventExcuse,
  useEventExcuses,
  useMyAttendance,
  useMyEventExcuse,
  useSendEventExcuse,
  useWithdrawEventExcuse,
  type EventExcuseWithMember,
} from "@repo/hooks";
import { EVENT_EXCUSE_REASON_MAX, statusLabel } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { StatusChip } from "@/components/status-chip";
import { createEventRowStyles } from "@/components/events/event-rows";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useConnection } from "@/lib/connection/use-connection";
import { useKeepAboveKeyboard } from "@/lib/keep-above-keyboard";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { eyebrowStyle } from "@/components/eyebrow";

/**
 * Absence excuses on the event page (`spec/behavior/events.md` § Excuses,
 * #3735). Two blocks, both drawn as flat one-line rows split by hairlines,
 * the way the series dates under them are, not as cards (#5115, Paul:
 * "mostly one line, not cards"):
 *
 * - {@link MyExcuse}, for the member the event requires: a quiet **Can't make
 *   it?** link opens one line in place ("Exam review"). Once sent it is one
 *   row, the reason and where it stands, with **Edit** while the server
 *   allows it. Calendar apps put "can't go, with a note" on the event itself
 *   (Google Calendar's Decline with a note, Outlook's Decline with a
 *   message), and let the note be changed there too.
 * - {@link ExcuseReviewSection}, for whoever decides: the event's creator or
 *   an `events:update` holder. One row per excuse, pending first, with
 *   Approve and Decline at the row's end, as a request row reads in Slack's
 *   or Linear's inbox. Tapping a row shows the whole reason.
 *
 * What each offers is `myExcuseView`'s rule in `@repo/hooks`, which web's
 * event sheet reads too; the server enforces it either way. The writes have
 * no outbox, so they are disabled while a write would be lost.
 */
export function MyExcuse({
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
  const rows = createEventRowStyles(tokens);
  const { writeBlockedReason } = useConnection();

  // Read only for an event that requires the viewer: nobody else can have
  // sent one, so a member at an optional event costs no request.
  const mine = useMyEventExcuse(eventId, { enabled: required });
  const own = useMyAttendance(eventId);
  const send = useSendEventExcuse();
  const edit = useEditEventExcuse();
  const withdraw = useWithdrawEventExcuse();
  const [writing, setWriting] = useState(startWriting);
  const [error, setError] = useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
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

  const run = async (write: () => Promise<unknown>, fallback: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      await write();
      setWriting(false);
    } catch (failure) {
      setError(errorCopy(failure, fallback, { serverWritesForMembers: true }));
    } finally {
      inFlight.current = false;
    }
  };

  if (view.kind === "offer") {
    // Closed, the offer is one quiet underlined line: declining reads quieter
    // than going (#4933, the way Google Calendar's and Luma's RSVP rows keep
    // No secondary). Writing opens one field in its place, not a card.
    if (!writing) {
      return (
        <TextAction
          label="Can't make it?"
          hint="Send an excuse for this event."
          underline
          onPress={() => setWriting(true)}
        />
      );
    }
    return (
      <ExcuseComposer
        label="Can't make it"
        caption="Say why in one line. It goes to whoever runs this event."
        submitLabel="Send"
        submitA11y="Send excuse"
        busy={send.isPending}
        error={error}
        onSubmit={(reason) =>
          void run(
            () => send.mutateAsync({ eventId, reason }),
            "Couldn't send your excuse. Try again.",
          )
        }
        onCancel={() => {
          setWriting(false);
          setError(null);
        }}
      />
    );
  }

  const declined = view.status === "DECLINED";
  if (writing && view.canEdit) {
    return (
      <ExcuseComposer
        label="Your excuse"
        caption={
          declined
            ? "Change it and send it again. You're still expected until it's accepted."
            : view.title
        }
        initial={view.reason}
        submitLabel={declined ? "Send again" : "Save"}
        submitA11y={declined ? "Send excuse again" : "Save excuse"}
        busy={edit.isPending}
        error={error}
        onSubmit={(reason) =>
          void run(
            () => edit.mutateAsync({ eventId, reason }),
            "Couldn't save your excuse. Try again.",
          )
        }
        onCancel={() => {
          setWriting(false);
          setError(null);
        }}
        withdraw={
          view.canWithdraw
            ? {
                pending: withdraw.isPending,
                onPress: () =>
                  void run(
                    () => withdraw.mutateAsync({ eventId }),
                    "Couldn't withdraw your excuse. Try again.",
                  ),
              }
            : null
        }
      />
    );
  }

  // One row: the reason, where it stands, and the one thing it allows. The
  // receiver ("Sent to Jake") rides the section label, not a second line.
  const action: "edit" | "withdraw" | null = view.canEdit
    ? "edit"
    : view.canWithdraw
      ? "withdraw"
      : null;
  const takeBack = () =>
    void run(
      () => withdraw.mutateAsync({ eventId }),
      "Couldn't withdraw your excuse. Try again.",
    );
  return (
    <View style={styles.section} accessibilityLabel="Your excuse">
      <Text style={styles.sectionLabel}>
        {view.status === "PENDING"
          ? `Your excuse · ${view.title.replace(/^Excuse sent/, "Sent")}`
          : "Your excuse"}
      </Text>
      <View style={[rows.flatRow, reasonOpen ? styles.rowTop : null]}>
        {/* Cut to one line; a tap shows the whole reason, as on the
            receiver's list. A sibling of the action, so each stays its own
            control for VoiceOver. */}
        <Pressable
          style={({ pressed }) => [
            styles.grow,
            pressed ? styles.pressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${view.title}: ${view.reason}`}
          accessibilityHint={
            reasonOpen ? "Shows one line." : "Shows the whole reason."
          }
          accessibilityState={{ expanded: reasonOpen }}
          onPress={() => setReasonOpen((value) => !value)}
        >
          <Text
            style={styles.reason}
            numberOfLines={reasonOpen ? undefined : 1}
          >
            {view.reason}
          </Text>
        </Pressable>
        <StatusChip
          label={statusLabel("eventExcuse", view.status)}
          hue={excuseHue(tokens, view.status)}
        />
        {action ? (
          <TextAction
            label={
              action === "edit"
                ? "Edit"
                : withdraw.isPending
                  ? "Withdrawing…"
                  : "Withdraw"
            }
            hint={
              writeBlockedReason ??
              (action === "withdraw"
                ? "Take back your excuse."
                : declined
                  ? "Change your excuse and send it again."
                  : "Change your excuse.")
            }
            color={accent}
            compact
            disabled={withdraw.isPending || writeBlockedReason !== null}
            onPress={action === "edit" ? () => setWriting(true) : takeBack}
          />
        ) : null}
      </View>
      {view.detail ? <Text style={styles.caption}>{view.detail}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * The excuse line, new or being edited: one field with its button beside it,
 * and a caption and Cancel under it. Flat on the page, so opening it moves
 * nothing but the row it replaces.
 */
function ExcuseComposer({
  label,
  caption,
  initial = "",
  submitLabel,
  submitA11y,
  busy,
  error,
  onSubmit,
  onCancel,
  withdraw = null,
}: {
  label: string;
  caption: string;
  initial?: string;
  submitLabel: string;
  submitA11y: string;
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  withdraw?: { pending: boolean; onPress: () => void } | null;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const field = sheetFieldStyles(tokens, accent);
  const { writeBlockedReason } = useConnection();
  const [reason, setReason] = useState(initial);
  const trimmed = reason.trim();
  // Saving the words already there would ask the server for nothing.
  const unchanged = initial !== "" && trimmed === initial.trim();
  const blocked = !trimmed || unchanged || busy || writeBlockedReason !== null;
  // On Event details the line stays above the keyboard while it is typed.
  const { hold, ...keep } = useKeepAboveKeyboard();

  return (
    <View
      ref={hold}
      onLayout={keep.onLayout}
      style={styles.section}
      accessibilityLabel={label}
    >
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.composerRow}>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Exam review, away game, sick…"
          placeholderTextColor={tokens.color.text.muted}
          maxLength={EVENT_EXCUSE_REASON_MAX}
          autoFocus
          onFocus={keep.onFocus}
          onBlur={keep.onBlur}
          returnKeyType="send"
          onSubmitEditing={() => {
            if (!blocked) onSubmit(trimmed);
          }}
          accessibilityLabel="Reason"
          style={[field.field, styles.grow]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={submitA11y}
          accessibilityState={{ disabled: blocked, busy }}
          accessibilityHint={writeBlockedReason ?? undefined}
          disabled={blocked}
          onPress={() => onSubmit(trimmed)}
          style={({ pressed }) => [
            styles.submit,
            { backgroundColor: accent },
            pressed && !blocked ? styles.pressed : null,
            blocked && !busy ? styles.disabled : null,
          ]}
        >
          {/* The label keeps its width while saving, so nothing shifts. */}
          <Text
            style={[
              styles.submitLabel,
              { color: tokens.color.gold.onHouse },
              busy ? styles.busyLabel : null,
            ]}
          >
            {submitLabel}
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composerFoot}>
        <Text style={[styles.caption, styles.grow]}>{caption}</Text>
        {withdraw ? (
          <TextAction
            label={withdraw.pending ? "Withdrawing…" : "Withdraw"}
            compact
            disabled={withdraw.pending || writeBlockedReason !== null}
            hint={writeBlockedReason ?? "Take back your excuse."}
            onPress={withdraw.onPress}
          />
        ) : null}
        <TextAction label="Cancel" compact onPress={onCancel} />
      </View>
    </View>
  );
}

/**
 * The receiver's list: "EXCUSES · 2 to decide · 12 excused", then one row
 * per excuse: the sender's name, the reason cut to the row, and either
 * Approve and Decline or where it stands. Mounted only for a viewer who may
 * decide (the event's creator or an `events:update` holder); any other
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
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const rowStyles = createEventRowStyles(tokens);
  const excuses = useEventExcuses(eventId);
  const decide = useDecideEventExcuse();
  const { writeBlockedReason } = useConnection();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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
      <View>
        {ordered.map((row, index) => {
          const name = row.display_name.trim() || "A member";
          // The creator's own excuse goes to the officers: shown, not decided.
          const decidable = canDecideExcuse(row, decider);
          const disabled = deciding !== null || writeBlockedReason !== null;
          const expanded = open === row.id;
          return (
            // The text and the decisions are siblings, not one pressable
            // row: an accessible parent would hide Approve and Decline from
            // VoiceOver.
            <View
              key={row.id}
              style={[
                rowStyles.flatRow,
                expanded ? styles.rowTop : null,
                index === 0 ? null : rowStyles.flatDivider,
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${name}: ${row.reason}. ${statusLabel("eventExcuse", row.status)}`}
                accessibilityHint={
                  expanded ? "Shows one line." : "Shows the whole reason."
                }
                accessibilityState={{ expanded }}
                onPress={() => setOpen(expanded ? null : row.id)}
                style={({ pressed }) => [
                  styles.grow,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text
                  style={[styles.line, expanded ? null : styles.lineCut]}
                  numberOfLines={expanded ? undefined : 1}
                >
                  <Text style={styles.name}>{name}</Text>
                  {"  "}
                  <Text style={styles.reasonMuted}>{row.reason}</Text>
                </Text>
              </Pressable>
              {decidable ? (
                <View style={styles.decisions}>
                  <TextAction
                    label="Decline"
                    compact
                    disabled={disabled}
                    hint={writeBlockedReason ?? `Keep ${name} required.`}
                    onPress={() => void run(row, "DECLINED")}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled,
                      busy: deciding === row.user_id,
                    }}
                    accessibilityHint={writeBlockedReason ?? `Excuse ${name}.`}
                    disabled={disabled}
                    onPress={() => void run(row, "APPROVED")}
                    hitSlop={tokens.spacing.sm}
                    style={({ pressed }) => [
                      styles.approve,
                      { borderColor: accent },
                      pressed && !disabled ? styles.pressed : null,
                      disabled && deciding !== row.user_id
                        ? styles.disabled
                        : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.approveLabel,
                        { color: accent },
                        deciding === row.user_id ? styles.busyLabel : null,
                      ]}
                    >
                      Approve
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <StatusChip
                  label={statusLabel("eventExcuse", row.status)}
                  hue={excuseHue(tokens, row.status)}
                />
              )}
            </View>
          );
        })}
      </View>
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

export function TextAction({
  label,
  onPress,
  color,
  disabled = false,
  hint,
  underline = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  hint?: string;
  /** The standalone quiet link: underlined, centered, padded to 44×44. */
  underline?: boolean;
  /** At a row's end: hugs its label, and reaches 44pt through its slop. */
  compact?: boolean;
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
      hitSlop={compact ? tokens.spacing.sm : undefined}
      style={({ pressed }) => [
        compact ? styles.textActionCompact : styles.textAction,
        underline ? styles.textLink : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text
        style={[
          styles.textActionLabel,
          underline ? styles.textLinkLabel : null,
          { color: color ?? tokens.color.text.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    section: {
      gap: tokens.spacing.xs,
    },
    sectionLabel: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.muted,
    },
    grow: {
      flex: 1,
      minWidth: 0,
    },
    // An opened row reads from its top, so a long reason doesn't center
    // the buttons against three lines.
    rowTop: {
      alignItems: "flex-start",
    },
    line: {
      ...typeRole(tokens.typography.role.body),
    },
    lineCut: {
      // A cut line never wraps under the name.
      flexShrink: 1,
    },
    name: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    reason: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.body),
    },
    reasonMuted: {
      color: tokens.color.text.mutedForeground,
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
    composerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    composerFoot: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    submit: {
      minHeight: tokens.touch.minimum,
      minWidth: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      alignItems: "center",
      justifyContent: "center",
    },
    submitLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    // Saving: the label dims in place rather than swapping for a spinner.
    busyLabel: {
      opacity: 0.6,
    },
    decisions: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    approve: {
      borderWidth: 1,
      borderRadius: tokens.radius.control,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.xs,
    },
    approveLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    textAction: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    textActionCompact: {
      paddingVertical: tokens.spacing.xs,
    },
    textActionLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    textLink: {
      alignSelf: "center",
      minWidth: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
    },
    textLinkLabel: {
      textDecorationLine: "underline",
    },
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
