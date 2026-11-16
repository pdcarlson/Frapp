import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Path } from "react-native-svg";
import {
  calendarBirthdayLabel,
  type CalendarBirthday,
} from "@repo/hooks/calendar-birthdays";
import {
  CALENDAR_LAYERS,
  calendarTaskAccessibleLabel,
  type CalendarItem,
  type CalendarLayer,
  type CalendarTask,
  type CalendarTaskState,
} from "@repo/hooks/calendar-tasks";
import { SignetTokens } from "@repo/theme/signet";
import { DisclosureGlyph, ForwardGlyph } from "@/components/control-glyphs";
import { LEAD_TILE_SIZE, LeadTile } from "@/components/lead-tile";
import { Chip } from "@/components/filter-chips";
import { PressableRow } from "@/components/list-section";
import { createEventRowStyles } from "@/components/events/event-rows";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { Frame, paint } from "@/components/more/more-glyphs";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Tasks on the Events calendar (#4144), as web draws them: an event is a
 * row with its time, a task leads with a round mark that says where it
 * stands, in the lead tile an event's row has (#4679). An empty ring is
 * still to do (red when overdue), a ring with a check is done and waiting
 * on an officer, a filled green check is confirmed. Rules and words:
 * `@repo/hooks/calendar-tasks`.
 */

function TaskMark({
  state,
  size = 18,
}: {
  state: CalendarTaskState;
  size?: number;
}) {
  const { tokens } = useFrappTheme();
  const ring =
    state === "overdue"
      ? tokens.color.semantic.destructiveText
      : state === "confirmed"
        ? tokens.color.semantic.success
        : tokens.color.text.mutedForeground;
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: ring,
        backgroundColor:
          state === "confirmed" ? tokens.color.semantic.success : undefined,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {state === "waiting" || state === "confirmed" ? (
        <CheckGlyph
          size={Math.round(size * 0.6)}
          color={
            state === "confirmed"
              ? tokens.color.surface.background
              : tokens.color.text.mutedForeground
          }
        />
      ) : null}
    </View>
  );
}

/**
 * A birthday's cake (#4959), web's Lucide `Cake`, so a member's birthday reads
 * apart from an event's row and a task's ring on both apps.
 */
function CakeGlyph({ color, size }: { color: string; size: number }) {
  const { detail } = paint({ color });
  return (
    <Frame size={size}>
      <Path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8" {...detail} />
      <Path
        d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"
        {...detail}
      />
      <Path
        d="M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"
        {...detail}
      />
    </Frame>
  );
}

/**
 * A member's birthday under the picked day (#4959): the cake in the lead
 * tile, their name, and "Birthday". Nothing to open: like Google Calendar's
 * birthdays, it is a reminder, not an event.
 */
function BirthdayRow({
  item,
  isFirst,
}: {
  item: CalendarBirthday;
  isFirst: boolean;
}) {
  const { tokens } = useFrappTheme();
  const rowStyles = createEventRowStyles(tokens);
  return (
    <View
      accessible
      accessibilityLabel={calendarBirthdayLabel(item)}
      style={[rowStyles.leadRow, isFirst ? null : rowStyles.flatDivider]}
    >
      <LeadTile size="lead" testID="calendar-birthday-lead">
        <CakeGlyph color={tokens.color.text.mutedForeground} size={18} />
      </LeadTile>
      <View style={rowStyles.body}>
        <Text numberOfLines={1} style={rowStyles.leadTitle}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={rowStyles.meta}>
          Birthday
        </Text>
      </View>
    </View>
  );
}

/** A task or a birthday under the picked day. */
export function CalendarTaskRow({
  item,
  isFirst,
  nameOf,
  onOpenTask,
}: {
  item: CalendarItem;
  isFirst: boolean;
  nameOf: (userId: string) => string;
  onOpenTask: (taskId: string) => void;
}) {
  if (item.kind === "birthdays") {
    return <BirthdayRow item={item} isFirst={isFirst} />;
  }
  return (
    <TaskRow
      item={item}
      isFirst={isFirst}
      nameOf={nameOf}
      onOpenTask={onOpenTask}
    />
  );
}

/**
 * One task under the picked day. The member's own opens it on the Tasks
 * tab; one they assigned opens in place to list each assignee and where
 * they stand, since that is what an officer checks it for.
 */
function TaskRow({
  item,
  isFirst,
  nameOf,
  onOpenTask,
}: {
  item: CalendarTask;
  isFirst: boolean;
  nameOf: (userId: string) => string;
  onOpenTask: (taskId: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const rowStyles = createEventRowStyles(tokens);
  const styles = createStyles(tokens);
  const [expanded, setExpanded] = useState(false);
  const done = item.state === "waiting" || item.state === "confirmed";
  const meta =
    item.kind === "mine"
      ? item.label
      : item.assignees.length === 1
        ? `${nameOf(item.assignees[0]!.userId)} · ${item.progress}`
        : `Assigned by you · ${item.progress}`;
  const canExpand = item.kind === "assigned" && item.assignees.length > 1;

  return (
    <View>
      <PressableRow
        accessibilityRole="button"
        accessibilityLabel={calendarTaskAccessibleLabel(item)}
        accessibilityHint={
          item.kind === "mine"
            ? "Opens it on Tasks."
            : canExpand
              ? "Shows who it went to."
              : undefined
        }
        accessibilityState={canExpand ? { expanded } : undefined}
        disabled={item.kind === "assigned" && !canExpand}
        onPress={() => {
          if (item.kind === "mine") onOpenTask(item.taskId);
          else if (canExpand) setExpanded((open) => !open);
        }}
        style={[rowStyles.leadRow, isFirst ? null : rowStyles.flatDivider]}
      >
        {/* The mark sits in the event rows' tile, so a day's events and
            tasks share one text column (#4679). */}
        <LeadTile size="lead" testID="calendar-task-lead">
          <TaskMark state={item.state} />
        </LeadTile>
        <View style={rowStyles.body}>
          <Text
            numberOfLines={1}
            style={[
              rowStyles.leadTitle,
              done ? styles.doneTitle : null,
              item.state === "confirmed" ? styles.struck : null,
            ]}
          >
            {item.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              rowStyles.meta,
              item.state === "overdue" ? styles.overdue : null,
            ]}
          >
            {meta}
          </Text>
        </View>
        {canExpand ? (
          // It opens in place, so it draws the chevron that turns: right
          // while the assignees are hidden, down while they show
          // (`patterns.md` § Rows). Until #4679 it was the image viewer's
          // chevron turned by hand, which pointed down while folded.
          <DisclosureGlyph
            direction={expanded ? "down" : "right"}
            color={tokens.color.text.mutedForeground}
          />
        ) : item.kind === "mine" ? (
          // It opens on Tasks, so it draws the chevron of a row that opens.
          <ForwardGlyph color={tokens.color.text.mutedForeground} />
        ) : null}
      </PressableRow>
      {canExpand && expanded && item.kind === "assigned" ? (
        <View style={styles.assignees}>
          {item.assignees.map((assignee) => (
            <View
              key={assignee.taskId}
              accessible
              accessibilityLabel={`${nameOf(assignee.userId)}, ${assignee.label}`}
              style={styles.assignee}
            >
              <TaskMark state={assignee.state} size={14} />
              <Text numberOfLines={1} style={styles.assigneeName}>
                {nameOf(assignee.userId)}
              </Text>
              <Text
                style={[
                  styles.assigneeStatus,
                  assignee.state === "overdue" ? styles.overdue : null,
                ]}
              >
                {assignee.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A task in the 3 days or Day view's All day strip (#4818), where a column
 * is too narrow for a row: its mark and title. The member's own opens on
 * Tasks; one they assigned is read out with where it stands, and its
 * assignees are a tap away on Month's day list.
 */
export function CalendarTaskChip({
  item,
  onOpenTask,
}: {
  item: CalendarItem;
  onOpenTask: (taskId: string) => void;
}) {
  if (item.kind === "birthdays") return <BirthdayChip item={item} />;
  return <TaskChip item={item} onOpenTask={onOpenTask} />;
}

/** A birthday in the All day strip (#4959): the cake and the name. */
function BirthdayChip({ item }: { item: CalendarBirthday }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      accessible
      accessibilityLabel={calendarBirthdayLabel(item)}
      style={styles.chip}
    >
      <CakeGlyph color={tokens.color.text.mutedForeground} size={12} />
      <Text numberOfLines={1} style={styles.chipTitle}>
        {item.title}
      </Text>
    </View>
  );
}

function TaskChip({
  item,
  onOpenTask,
}: {
  item: CalendarTask;
  onOpenTask: (taskId: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const done = item.state === "waiting" || item.state === "confirmed";
  return (
    <Pressable
      accessibilityRole={item.kind === "mine" ? "button" : "text"}
      accessibilityLabel={calendarTaskAccessibleLabel(item)}
      accessibilityHint={
        item.kind === "mine" ? "Opens it on Tasks." : undefined
      }
      disabled={item.kind !== "mine"}
      onPress={() => {
        if (item.kind === "mine") onOpenTask(item.taskId);
      }}
      style={({ pressed }) => [
        styles.chip,
        pressed ? { backgroundColor: tokens.color.surface.card } : null,
      ]}
    >
      <TaskMark state={item.state} size={12} />
      <Text
        numberOfLines={1}
        style={[
          styles.chipTitle,
          done ? styles.doneTitle : null,
          item.state === "confirmed" ? styles.struck : null,
        ]}
      >
        {item.title}
      </Text>
    </Pressable>
  );
}

/**
 * What the calendar shows, as chips that double as its key: each carries
 * the mark its kind is drawn with. Only kinds the member has are offered.
 */
export function CalendarLayerChips({
  offered,
  shown,
  onToggle,
}: {
  offered: ReadonlySet<CalendarLayer>;
  shown: ReadonlySet<CalendarLayer>;
  onToggle: (layer: CalendarLayer) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel="Show on calendar"
      style={styles.chips}
    >
      {CALENDAR_LAYERS.filter((layer) => offered.has(layer.value)).map(
        (layer) => {
          const on = shown.has(layer.value);
          return (
            <Chip
              key={layer.value}
              label={layer.label}
              on={on}
              accessibilityRole="switch"
              accessibilityLabel={layer.label}
              accessibilityState={{ checked: on }}
              onPress={() => onToggle(layer.value)}
            />
          );
        },
      )}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    doneTitle: {
      color: tokens.color.text.mutedForeground,
    },
    struck: {
      textDecorationLine: "line-through",
    },
    overdue: {
      color: tokens.color.semantic.destructiveText,
    },
    assignees: {
      gap: tokens.spacing.sm,
      // Under the row's text column: past the lead tile and the row's gap.
      paddingLeft: LEAD_TILE_SIZE.lead + tokens.spacing.md,
      paddingBottom: tokens.spacing.md,
    },
    assignee: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    assigneeName: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    assigneeStatus: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 4,
      paddingVertical: 3,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.surface1,
    },
    chipTitle: {
      flex: 1,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
  });
}
