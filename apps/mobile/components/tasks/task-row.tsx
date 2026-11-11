import { Pressable, StyleSheet, Text, View } from "react-native";
import { TASK_ACTION_LABELS, taskStatusLabel } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { AccentChip } from "@/components/status-chip";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";
import {
  formatDueSubtitle,
  formatPointsChip,
  isDueUrgent,
} from "@/lib/tasks/format";
import type { TaskRowModel } from "@/lib/tasks/board";

/**
 * One row of the s08 board — `canvas-screens.dc.html:282-324`.
 *
 * A flush row on the screen background, split from the one above by a
 * hairline, with a leading checkbox, a title, a due/done subtitle, and an
 * optional trailing points chip.
 * The finished row is drawn at `opacity:.62` with a line-through title and a
 * box in the raised neutral fill with a muted check. Canvas draws that box
 * gold; foundations.md §6 ("Where the accent goes", 2026-11-05) overrides it:
 * finished work is the quietest thing on a list, so a done state takes a muted
 * fill or check, never the accent.
 *
 * ## Two targets: the box completes, the row opens
 *
 * Only the checkbox changes the task; a tap anywhere else on the row opens the
 * task's detail sheet (owner audit 2026-11-06, P6.1). The whole row used to be
 * the checkbox, so a stray tap while scrolling marked a task done. The box
 * unchecks too, while no officer has confirmed it, so a mis-tap is one tap to
 * take back, as a checked reminder is.
 *
 * A finished row says who it is waiting on ("Waiting on an officer", the
 * shared word from `@repo/hooks`), not "Done": the member's half is done, and
 * the points aren't theirs until an officer confirms. Only a confirmed row
 * dims.
 *
 * ## The checkbox is a three-state control, not a two-state one
 *
 * Canvas draws two boxes — empty and gold-filled — because it draws a *moment*,
 * not a lifecycle. The server has three assignee-reachable states, and
 * completing a fresh task is two writes (`lib/tasks/transitions.ts`). Between
 * them the row sits at `IN_PROGRESS`, and reusing the empty box there would make
 * the member's first tap look like it did nothing.
 *
 * TODO-DESIGN: the started state is drawn nowhere. Nearest pattern used — a
 * firmer neutral outline (`text.mutedForeground`) than the empty box's faint
 * one, with no fill, so it reads as "between" the empty and done boxes while
 * staying off the accent (foundations.md §6).
 */

export interface TaskRowProps {
  row: TaskRowModel;
  now: Date;
  /**
   * The checkbox: completes an open task, or takes back the viewer's own
   * unconfirmed completion. Omitted when the server allows neither, and the
   * box then draws inert, never a no-op handler.
   */
  onToggle?: () => void;
  /** Opens the task's detail sheet. Any tap on the row outside the box. */
  onOpen?: () => void;
  /**
   * True while this row's own PATCH sequence is in flight. The Tasks screen
   * drops `onToggle` for that time; the row dims and reads busy.
   */
  isPending?: boolean;
  /** The first row of its group draws no hairline above it. */
  isFirst?: boolean;
}

/** The checkbox's hit area past its drawn 24pt, to a 44pt target. */
const CHECKBOX_SLOP = 10;

export function TaskRow({
  row,
  now,
  onToggle,
  onOpen,
  isPending = false,
  isFirst = false,
}: TaskRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const chip = formatPointsChip(row.pointReward, row.pointsAwarded);
  const started = row.storedStatus === "IN_PROGRESS";
  const confirmed = row.isDone && row.pointsAwarded;

  const statusLine = row.isDone
    ? taskStatusLabel({
        status: "COMPLETED",
        points_awarded: row.pointsAwarded,
      })
    : formatDueSubtitle(row.dueDate, now);
  // How far through its checklist it is, beside the due: "Due today · 2 of
  // 5" (#4003). A finished task drops it; its status says enough.
  const progress =
    !row.isDone && row.subtasks.length > 0
      ? `${row.subtasks.filter((subtask) => subtask.done).length} of ${row.subtasks.length}`
      : null;
  const subtitle = [statusLine, progress].filter(Boolean).join(" · ") || null;

  // `semantic.destructive`, never `semantic.mention` — `foundations.md:67`
  // reserves the mention red for direct address, and an overdue task is not
  // someone speaking to you.
  const urgent = !row.isDone && !!row.dueDate && isDueUrgent(row.dueDate, now);

  const toggleLabel = row.isDone
    ? TASK_ACTION_LABELS.reopen
    : TASK_ACTION_LABELS.complete;

  const box = (
    <View
      style={[
        styles.checkbox,
        row.isDone
          ? styles.checkboxDone
          : started
            ? styles.checkboxStarted
            : null,
      ]}
    >
      {row.isDone ? (
        <CheckGlyph color={tokens.color.text.mutedForeground} />
      ) : null}
    </View>
  );

  const body = (
    <>
      {onToggle ? (
        // Hidden from screen readers: the row carries the same move as a
        // named action, so VoiceOver and TalkBack reach it without a second
        // focus stop nested inside the row's.
        <Pressable
          testID={`task-checkbox-${row.id}`}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          hitSlop={CHECKBOX_SLOP}
          onPress={onToggle}
        >
          {box}
        </Pressable>
      ) : (
        box
      )}

      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[styles.title, row.isDone ? styles.titleDone : null]}
        >
          {row.title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              styles.subtitle,
              urgent ? styles.subtitleUrgent : null,
              confirmed ? styles.subtitleDone : null,
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {chip ? (
        chip.tone === "awarded" ? (
          <Text style={styles.awardedChip}>{chip.label}</Text>
        ) : (
          <AccentChip label={chip.label} />
        )
      ) : null}
    </>
  );

  // A row in flight is dimmed less than a confirmed one; the confirmed dim
  // comes second so it wins.
  const rowStyle = [
    styles.row,
    isFirst ? null : styles.rowDivider,
    isPending ? styles.rowPending : null,
    confirmed ? styles.rowDone : null,
  ];
  const label = `${row.title}${subtitle ? `, ${subtitle}` : ""}`;

  if (!onOpen) {
    return (
      <View
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: row.isDone,
          disabled: !onToggle,
          busy: isPending,
        }}
        accessibilityLabel={label}
        accessibilityActions={
          onToggle ? [{ name: "activate", label: toggleLabel }] : undefined
        }
        onAccessibilityAction={onToggle}
        style={rowStyle}
      >
        {body}
      </View>
    );
  }

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityState={{ checked: row.isDone, busy: isPending }}
      accessibilityLabel={label}
      accessibilityHint="Opens the task."
      // The box's move as a named action, so it is one swipe-up away on
      // VoiceOver and in TalkBack's actions menu, rather than the row's
      // default tap, which opens the task.
      accessibilityActions={
        onToggle ? [{ name: "toggle", label: toggleLabel }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "toggle") onToggle?.();
      }}
      onPress={onOpen}
      style={rowStyle}
    >
      {body}
    </PressableRow>
  );
}

/** Title widths, cycled, so the placeholder rows don't read as a grid. */
const SKELETON_TITLE_WIDTHS = ["58%", "44%", "52%"] as const;

/**
 * A {@link TaskRow} that hasn't loaded, on the row's own styles: the row and
 * its hairline (none on a section's first row), a block in the checkbox's
 * square, the title and due lines, and a chip where the points land. Placed
 * inside a `SkeletonRegion` (`components/state-block.tsx`).
 */
export function TaskRowSkeleton({ index = 0 }: { index?: number }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label } = tokens.typography.role;

  return (
    <View style={[styles.row, index === 0 ? null : styles.rowDivider]}>
      <SkeletonBlock width={tokens.spacing.xl} height={tokens.spacing.xl} />
      <View style={styles.body}>
        <SkeletonText
          role={label}
          width={SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length]!}
        />
        <SkeletonText role={caption} width="32%" />
      </View>
      <SkeletonBlock width={tokens.spacing["3xl"]} height={tokens.spacing.xl} />
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      // Flush on the floor, as web lists sit (owner pick 2026-11-05). It was a
      // bordered card per task, which stacked eight boxes down the tab.
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      // Square and hairline-split like the Directory's member rows, so it
      // bleeds the same way: content on the gutter line, press feedback clear
      // of it.
      ...gutterBleed(tokens, { rounded: false }),
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    rowDone: {
      // The drawn `opacity:.62`. A raw number because no token carries a
      // de-emphasis ramp.
      opacity: 0.62,
    },
    rowPending: {
      opacity: 0.8,
    },
    checkbox: {
      width: tokens.spacing.xl,
      height: tokens.spacing.xl,
      borderRadius: tokens.radius.chip,
      borderWidth: 1.5,
      // Canvas draws `rgba(255,255,255,.25)`. `tint` on the foreground role is
      // the sanctioned path for a low-opacity neutral; foreground is warm rather
      // than pure white, so this reads a touch warmer than the drawing by design.
      borderColor: tint(tokens.color.text.foreground, 0.25),
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxStarted: {
      borderColor: tokens.color.text.mutedForeground,
    },
    checkboxDone: {
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
    },
    body: {
      flex: 1,
      gap: 2,
    },
    title: {
      // TODO-DESIGN: Canvas sets 16px/600 and no such role exists — `label` is
      // 14/600. Following the ruling `components/list-section.tsx` already made
      // for a row title rather than inventing a second rule; `body` would match
      // the size but lose the weight.
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    titleDone: {
      textDecorationLine: "line-through",
      color: tokens.color.text.mutedForeground,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    subtitleUrgent: {
      // Danger as text takes the lift, as web's overdue label does.
      color: tokens.color.semantic.destructiveText,
    },
    subtitleDone: {
      color: tokens.color.text.muted,
    },
    awardedChip: {
      ...typeRole(tokens.typography.role.caption),
      // TODO-DESIGN: Canvas draws `#4BC262` here, which is not the Signet
      // success token (`#3FB950`) and has no token of its own. Using the
      // semantic role rather than a second green.
      color: tokens.color.semantic.success,
    },
  });
}
