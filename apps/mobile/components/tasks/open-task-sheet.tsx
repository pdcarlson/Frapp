import { forwardRef, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { formatPoints } from "@repo/formatting";
import { useMeeting, type OpenTask } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_SUGGESTION_COPY,
  TASK_AUDIENCE_COPY,
  TASK_PROOF_KIND_HINTS,
} from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { PressableRow } from "@/components/list-section";
import { formatDueDate } from "@/lib/tasks/format";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { WhoPickerSheet } from "@/components/tasks/who-picker-sheet";
import { useWhoDirectory } from "@/lib/tasks/use-who-directory";

export interface OpenTaskSheetProps {
  /** The posting opened, or `null` while none is. The sheet stays mounted. */
  posting: OpenTask | null;
  /** Who may claim it, in words (`openTaskWho`). */
  who: string | null;
  /** Claim it; left out when the viewer may not. */
  onClaim?: () => void;
  /** An officer hands it to one member (`tasks:manage`). */
  onAssign?: () => void;
  /** An officer takes it down (`tasks:manage`). */
  onDelete?: () => void;
  /** Why the last move didn't go through. */
  problem?: string | null;
  /** A hand-over or a delete in flight: the buttons hold. */
  busy?: boolean;
  onDismiss?: () => void;
}

/**
 * A task up for grabs, opened from its row on the Tasks screen (the Tasks
 * overhaul § 3): what it is, who may claim it, its due and points, what
 * Mark done will need, and Claim. An officer who manages tasks also gets
 * Assign to someone (any active member, as assigning a task always could) and
 * Delete, the moves the design gives the officer's row. Sized to its content,
 * as Mark done's sheet is (`mark-done-sheet.tsx`).
 */
export const OpenTaskSheet = forwardRef<BottomSheetModal, OpenTaskSheetProps>(
  function OpenTaskSheet(
    { posting, who, onClaim, onAssign, onDelete, problem, busy = false, onDismiss },
    ref,
  ) {
    const { tokens } = useFrappTheme();
    const { accent, accentOnPrimary } = useChapterBranding();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const due = posting
      ? formatDueDate(posting.due_at ?? posting.due_date)
      : null;
    const steps = posting?.subtask_titles.length ?? 0;

    return (
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        enableDynamicSizing
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onDismiss={onDismiss}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetScrollView
          onAccessibilityEscape={closeSheet}
          contentContainerStyle={styles.body}
        >
          {posting ? (
            <>
              <View style={styles.head}>
                <Text style={styles.title} accessibilityRole="header">
                  {posting.title}
                </Text>
                <Text style={styles.status}>
                  {TASK_AUDIENCE_COPY.upForGrabs}
                </Text>
              </View>

              <View style={styles.facts}>
                {who ? <Fact label="Who can claim" value={who} /> : null}
                {due ? (
                  <Fact label="Due" value={due.replace(/^Due /, "")} />
                ) : null}
                {posting.point_reward ? (
                  <Fact
                    label="Points"
                    value={formatPoints(posting.point_reward)}
                  />
                ) : null}
                {steps > 0 ? (
                  <Fact
                    label="Steps"
                    value={`${steps} ${steps === 1 ? "step" : "steps"}`}
                  />
                ) : null}
                {posting.meeting_id ? (
                  <MinutesFact
                    meetingId={posting.meeting_id}
                    onOpen={closeSheet}
                  />
                ) : null}
              </View>

              {posting.description ? (
                <Text style={styles.description} selectable>
                  {posting.description}
                </Text>
              ) : null}

              {posting.proof_kind !== "none" ? (
                <Text style={styles.note}>
                  {TASK_PROOF_KIND_HINTS[posting.proof_kind]}
                </Text>
              ) : null}

              {onClaim ? (
                <SheetPrimaryButton
                  label={TASK_AUDIENCE_COPY.claim}
                  onPress={onClaim}
                  disabled={busy}
                  accent={accent}
                  onAccent={accentOnPrimary}
                />
              ) : null}

              {onAssign ? (
                <PressableRow
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={onAssign}
                  style={styles.quietButton}
                >
                  <Text style={styles.quietLabel}>
                    {TASK_AUDIENCE_COPY.assignToSomeone}
                  </Text>
                </PressableRow>
              ) : null}

              {onDelete ? (
                <PressableRow
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={onDelete}
                  style={styles.quietButton}
                >
                  <Text style={[styles.quietLabel, styles.danger]}>Delete</Text>
                </PressableRow>
              ) : null}

              {problem ? (
                <Text style={styles.problem} accessibilityLiveRegion="polite">
                  {problem}
                </Text>
              ) : null}
            </>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

/**
 * The minutes the posting was suggested from, by id, with the meeting's name
 * as it is now (#5562); the task screen and the web panel show the same row.
 * Opening them closes the sheet first, so the minutes don't open under it.
 */
function MinutesFact({
  meetingId,
  onOpen,
}: {
  meetingId: string;
  onOpen: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const name = useMeeting(meetingId).data?.event_name;
  if (!name) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${AI_SUGGESTION_COPY.taskMinutes}: ${name}`}
      onPress={() => {
        onOpen();
        router.push({ pathname: "/minutes-details", params: { id: meetingId } });
      }}
      style={({ pressed }) => [styles.fact, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.factLabel}>{AI_SUGGESTION_COPY.taskMinutes}</Text>
      <Text style={[styles.factValue, { color: accent }]} numberOfLines={2}>
        {name}
      </Text>
    </Pressable>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      style={styles.fact}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.lg,
    },
    head: {
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    status: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    facts: {
      gap: tokens.spacing.sm,
    },
    fact: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
    },
    factLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    factValue: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
      textAlign: "right",
    },
    description: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    quietButton: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.control,
    },
    quietLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    danger: {
      color: tokens.color.semantic.destructiveText,
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}

/**
 * Assign to someone, for a task up for grabs: the Assign to picker limited
 * to one person, stacked over the posting's sheet. Mounted only for the
 * hand-over, so the members read it needs runs only for an officer who asks.
 * It opens as it mounts.
 */
export function OpenTaskAssignPicker({
  onPick,
  onClosed,
}: {
  onPick: (userId: string) => void;
  onClosed: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const read = useWhoDirectory({ groups: false });
  useEffect(() => {
    ref.current?.present();
  }, []);
  return (
    <WhoPickerSheet
      ref={ref}
      single
      title={TASK_AUDIENCE_COPY.assignToSomeone}
      value={null}
      onChange={(who) => {
        if (who?.kind === "person") onPick(who.userId);
      }}
      directory={read.directory}
      people={read.people}
      sets={read.sets}
      onDismiss={onClosed}
    />
  );
}
