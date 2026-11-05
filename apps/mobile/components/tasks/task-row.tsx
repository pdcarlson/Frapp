import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { type ChapterBranding, useChapterBranding } from "@/lib/chapter-branding";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { AccentChip } from "@/components/status-chip";
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
 * A flush row on the screen background, split from the one above by a
 * hairline, with a leading checkbox, a title, a due/done subtitle, and an
 * optional trailing points chip. The finished row is drawn at `opacity:.62` with a
 * line-through title and a box filled with the chapter accent (Canvas draws
 * it gold, the house accent).
 *
 * ## The checkbox is a three-state control, not a two-state one
 *
 * Canvas draws two boxes — empty and gold-filled — because it draws a *moment*,
 * not a lifecycle. The server has three assignee-reachable states, and
 * completing a fresh task is two writes (`lib/tasks/transitions.ts`). Between
 * them the row sits at `IN_PROGRESS`, and reusing the empty box there would make
 * the member's first tap look like it did nothing.
 *
 * TODO-DESIGN: the started state is drawn nowhere. Nearest pattern used — the
 * accent hairline outline the drawn empty box already implies, with no fill, so
 * it reads as "between" the two states Canvas does draw.
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
  /** The first row of its group draws no hairline above it. */
  isFirst?: boolean;
}

export function TaskRow({
  row,
  now,
  onToggle,
  isPending = false,
  isFirst = false,
}: TaskRowProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
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
        {row.isDone ? <CheckGlyph color={tokens.color.gold.onHouse} /> : null}
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
    isFirst ? null : styles.rowDivider,
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

  return (
    <PressableRow
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

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
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
      borderColor: brand.accent,
    },
    checkboxDone: {
      borderColor: brand.accent,
      backgroundColor: brand.accent,
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
