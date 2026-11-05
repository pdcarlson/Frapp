import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { PressableRow } from "@/components/list-section";
import { AccentChip } from "@/components/status-chip";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";
import {
  formatDoneSubtitle,
  formatDueSubtitle,
  formatPointsChip,
  isDueUrgent,
} from "@/lib/tasks/format";
import type { TaskRowModel } from "@/lib/tasks/board";

/**
 * One row of the s08 board — `canvas-screens.dc.html:282-324`.
 *
 * A card with a leading checkbox, a title, a due/done subtitle, and an optional
 * trailing points chip. The finished row is drawn at `opacity:.62` with a
 * line-through title and a box in the raised neutral fill with a muted check.
 * Canvas draws that box gold; foundations.md §6 ("Where the accent goes",
 * 2026-11-05) overrides it: finished work is the quietest thing on a list, so
 * a done state takes a muted fill or check, never the accent.
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
  /** Omitted entirely when the server allows no transition — never a no-op handler. */
  onToggle?: () => void;
  /**
   * True while this row's own PATCH sequence is in flight. The Tasks screen
   * drops `onToggle` for that time, so an in-flight row takes the plain branch;
   * it dims and reads busy whichever branch it takes.
   */
  isPending?: boolean;
}

export function TaskRow({ row, now, onToggle, isPending = false }: TaskRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const chip = formatPointsChip(row.pointReward, row.pointsAwarded);
  const started = row.storedStatus === "IN_PROGRESS";

  const subtitle = row.isDone
    ? formatDoneSubtitle(row.completedAt, now)
    : formatDueSubtitle(row.dueDate, now);

  // `semantic.destructive`, never `semantic.mention` — `foundations.md:67`
  // reserves the mention red for direct address, and an overdue task is not
  // someone speaking to you.
  const urgent =
    !row.isDone && !!row.dueDate && isDueUrgent(row.dueDate, now);

  const body = (
    <>
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
              row.isDone ? styles.subtitleDone : null,
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

  // A row in flight is dimmed less than a finished one; the finished dim comes
  // second so it wins if the optimistic write lands mid-sequence.
  const rowStyle = [
    styles.row,
    isPending ? styles.rowPending : null,
    row.isDone ? styles.rowDone : null,
  ];

  // No `onPress` at all rather than a handler that returns early: a Pressable
  // that silently swallows taps reads as broken, and the server allows this row
  // nothing, or its own PATCH sequence is still running.
  if (!onToggle) {
    return (
      <View
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: row.isDone,
          disabled: true,
          busy: isPending,
        }}
        accessibilityLabel={`${row.title}${subtitle ? `, ${subtitle}` : ""}`}
        style={rowStyle}
      >
        {body}
      </View>
    );
  }

  // The row is a card, so its iOS lift is to the popover step (`onCard`).
  return (
    <PressableRow
      onCard
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.isDone, busy: isPending }}
      accessibilityLabel={`${row.title}${subtitle ? `, ${subtitle}` : ""}`}
      // One tap completes the task, whatever it currently reads as: a `TODO`
      // row walks IN_PROGRESS then COMPLETED. Saying "Start this task" here
      // told a screen-reader user the tap was reversible groundwork, when the
      // server has no assignee transition out of COMPLETED and this app ships
      // no reject affordance — only an officer could undo it.
      accessibilityHint="Mark this task done."
      onPress={onToggle}
      style={rowStyle}
    >
      {body}
    </PressableRow>
  );
}

/** Title widths, cycled, so the placeholder rows don't read as a grid. */
const SKELETON_TITLE_WIDTHS = ["58%", "44%", "52%"] as const;

/**
 * A {@link TaskRow} that hasn't loaded, on the row's own styles: the card, a
 * block in the checkbox's square, the title and due lines, and a chip where
 * the points land. Placed inside a `SkeletonRegion`
 * (`components/state-block.tsx`).
 */
export function TaskRowSkeleton({ index = 0 }: { index?: number }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label } = tokens.typography.role;

  return (
    <View style={styles.row}>
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
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      minHeight: tokens.touch.minimum,
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
      color: tokens.color.semantic.destructive,
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
