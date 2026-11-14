import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  formatDayHeading,
  localIsoDate,
  monthGrid,
  parseInstant,
  startOfMonth,
} from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { ChevronGlyph } from "@/components/chat/viewer-glyphs";
import { IconButton } from "@/components/icon-button";
import { InlineNote } from "@/components/inline-note";
import { DayHeading } from "@/components/list-section";
import { EventRowFlat } from "@/components/events/event-rows";
import { CalendarTaskRow } from "@/components/events/calendar-tasks";
import { EventsTimeGrid } from "@/components/events/events-time-grid";
import { Segmented } from "@/components/segmented";
import { useRequiredOfViewer } from "@repo/hooks";
import { consecutiveDays } from "@repo/hooks/calendar-time-grid";
import type { CalendarItem } from "@repo/hooks/calendar-tasks";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  CALENDAR_RANGE_DAYS,
  type CalendarRange,
} from "@/lib/events/events-view";
import { monthCellSummary } from "@/lib/events/month-cell";
import { selectSeriesCadence, type EventRow } from "@/lib/events/select";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s06's Calendar view (#3792): a month grid that writes each day's events by
 * title in its cell (#4987, `monthCellSummary`), the selected day's events
 * listed under it, and the month moved with the chevrons or a sideways swipe.
 *
 * Every occurrence of a series is marked on its own day, while the List draws
 * a series once (#3792 § Notes). The grid is `@repo/formatting`'s `monthGrid`,
 * the same six weeks from the Sunday on or before the 1st that web's calendar
 * draws (web moves onto the shared helper in #3822); a day is the viewer's
 * local calendar day (`localIsoDate`), as on web.
 *
 * The month and the selected day are the screen's state, not this
 * component's, so switching to List and back keeps the member's place.
 *
 * Beside Month sit 3 days and Day (#4818), the hour grids
 * (`events-time-grid.tsx`): seven columns don't fit a phone, so where web
 * offers Week the phone offers 3 days, as Google Calendar's phone app does.
 * Both start at the selected day, the one anchor every range shares, and
 * the chevrons or a swipe step it by the range's length.
 */

const RANGE_OPTIONS = [
  { value: "month", label: "Month" },
  { value: "3day", label: "3 days" },
  { value: "day", label: "Day" },
] as const satisfies readonly { value: CalendarRange; label: string }[];

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** A month cell's title text: below the caption role, see `cellLine`. */
const CELL_TEXT_SIZE = 11;
const CELL_LINE_HEIGHT = 16;

/** How far a finger travels sideways before a swipe turns the month. */
const SWIPE_DISTANCE = 48;

const NO_TASKS = new Map<string, CalendarItem[]>();
const fallbackName = () => "A member";

export function EventsCalendar({
  events,
  now,
  monthAnchor,
  selectedDay,
  onMonthChange,
  onSelectDay,
  onOpen,
  emptyNote = null,
  tasksByDay = NO_TASKS,
  nameOf = fallbackName,
  onOpenTask,
  layerChips = null,
  range = "month",
  onRangeChange,
  canCreate = false,
  onCreateAt,
}: {
  /** Every occurrence, past ones included (`selectAllEventRows`). */
  events: EventRow[];
  now: Date;
  /** Any day in the month on screen. */
  monthAnchor: Date;
  /** The day whose events list under the grid, local midnight. */
  selectedDay: Date;
  onMonthChange: (anchor: Date) => void;
  /** A tapped day; the screen moves the month to it as well. */
  onSelectDay: (day: Date) => void;
  onOpen: (id: string) => void;
  /**
   * What the day list says when nothing is scheduled by the List's test (no
   * current or upcoming event, so a chapter whose events are all past gets
   * it too): the List's own zero-state line, in place of "Nothing on this
   * day.".
   */
  emptyNote?: string | null;
  /**
   * Everything that isn't an event, by day, narrowed to the kinds switched
   * on: the member's tasks and the ones they assigned (#4144), and members'
   * shared birthdays (#4959). Listed under the day's events.
   */
  tasksByDay?: Map<string, CalendarItem[]>;
  nameOf?: (userId: string) => string;
  /** The member's own task, opened on the task board. */
  onOpenTask?: (taskId: string) => void;
  /** The Events / My tasks / Assigned by me / Birthdays chips, under the month. */
  layerChips?: ReactNode;
  /** Month, 3 days or Day; the switch shows only with `onRangeChange`. */
  range?: CalendarRange;
  onRangeChange?: (range: CalendarRange) => void;
  /** Whether an hour of the 3 days or Day grid opens New event. */
  canCreate?: boolean;
  /** An hour pressed in the grid: New event, starting then. */
  onCreateAt?: (day: Date, hour: number) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const requiredOf = useRequiredOfViewer();
  const styles = createStyles(tokens);

  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const event of events) {
      const start = parseInstant(event.start_time);
      if (!start) continue;
      const key = localIsoDate(start);
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [events]);

  const month = startOfMonth(monthAnchor);
  const days = monthGrid(month);
  const todayKey = localIsoDate(now);
  const selectedKey = localIsoDate(selectedDay);
  const dayEvents = byDay.get(selectedKey) ?? [];
  const dayTasks = tasksByDay.get(selectedKey) ?? [];

  const shiftMonth = (delta: number) => {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  };

  const span = range === "month" ? 0 : CALENDAR_RANGE_DAYS[range];
  const shiftDays = (delta: number) => {
    onSelectDay(
      new Date(
        selectedDay.getFullYear(),
        selectedDay.getMonth(),
        selectedDay.getDate() + delta * span,
      ),
    );
  };
  const shift = (delta: number) =>
    range === "month" ? shiftMonth(delta) : shiftDays(delta);

  // JS-thread callbacks: turning the month is React state. The offsets let a
  // vertical drag fall through to the screen's scroll view, or the grid's.
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onEnd((event: { translationX: number }) => {
      if (event.translationX <= -SWIPE_DISTANCE) shift(1);
      else if (event.translationX >= SWIPE_DISTANCE) shift(-1);
    });

  // Keyed on the day, not the Date: the screen makes a fresh one each
  // render while it follows the clock, which would rebuild the grid's
  // layout on every tick.
  const gridDays = useMemo(
    () => (span === 0 ? [] : consecutiveDays(selectedDay, span)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [selectedKey, span],
  );
  const headerLabel =
    range === "month"
      ? month.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : rangeLabel(gridDays, now);
  const stepNoun =
    range === "month" ? "month" : range === "day" ? "day" : "3 days";

  // `monthGrid` always draws six weeks; a week with no day of this month
  // is dropped, so a five-week month gives that row to the day list.
  const weeks = Array.from({ length: 6 }, (_, row) =>
    days.slice(row * 7, row * 7 + 7),
  ).filter((week) => week.some((day) => day.getMonth() === month.getMonth()));

  return (
    <View style={styles.root}>
      {onRangeChange ? (
        <Segmented
          options={RANGE_OPTIONS}
          value={range}
          onChange={onRangeChange}
          accessibilityLabel="Calendar range"
          dense
        />
      ) : null}
      <View style={styles.monthRow}>
        <IconButton label={`Previous ${stepNoun}`} onPress={() => shift(-1)}>
          <ChevronGlyph direction="left" color={tokens.color.text.foreground} />
        </IconButton>
        <Text accessibilityRole="header" style={styles.monthLabel}>
          {headerLabel}
        </Text>
        <IconButton label={`Next ${stepNoun}`} onPress={() => shift(1)}>
          <ChevronGlyph
            direction="right"
            color={tokens.color.text.foreground}
          />
        </IconButton>
      </View>

      {layerChips}

      {range !== "month" ? (
        <GestureDetector gesture={swipe}>
          <View style={styles.root}>
            {emptyNote ? <InlineNote>{emptyNote}</InlineNote> : null}
            <EventsTimeGrid
              days={gridDays}
              events={events}
              now={now}
              tasksByDay={tasksByDay}
              onOpen={onOpen}
              onOpenTask={(taskId) => onOpenTask?.(taskId)}
              onOpenDay={
                onRangeChange
                  ? (day) => {
                      onSelectDay(day);
                      onRangeChange("day");
                    }
                  : undefined
              }
              canCreate={canCreate && onCreateAt !== undefined}
              onCreateAt={(day, hour) => onCreateAt?.(day, hour)}
            />
          </View>
        </GestureDetector>
      ) : (
        <>
          <GestureDetector gesture={swipe}>
            <View style={styles.grid}>
              <View
                style={styles.week}
                importantForAccessibility="no-hide-descendants"
              >
                {WEEKDAY_INITIALS.map((initial, index) => (
                  <Text key={index} style={styles.weekday}>
                    {initial}
                  </Text>
                ))}
              </View>
              {weeks.map((week) => (
                <View key={localIsoDate(week[0]!)} style={styles.week}>
                  {week.map((day) => {
                    const key = localIsoDate(day);
                    const cell = monthCellSummary(
                      byDay.get(key) ?? [],
                      tasksByDay.get(key) ?? [],
                      requiredOf,
                    );
                    const spoken = [
                      cell.eventCount === 0
                        ? null
                        : `${cell.eventCount} ${cell.eventCount === 1 ? "event" : "events"}`,
                      ...cell.lines
                        .filter((line) => line.kind === "event")
                        .map((line) => line.title),
                      cell.hidden > 0 ? `${cell.hidden} more` : null,
                      cell.taskCount === 0
                        ? null
                        : `${cell.taskCount} ${cell.taskCount === 1 ? "task" : "tasks"}`,
                      cell.overdue ? "overdue" : null,
                      cell.birthdayCount === 0
                        ? null
                        : `${cell.birthdayCount} ${cell.birthdayCount === 1 ? "birthday" : "birthdays"}`,
                    ].filter(Boolean);
                    const footer = [
                      cell.hidden > 0 ? `+${cell.hidden}` : null,
                      cell.taskCount === 0
                        ? null
                        : cell.overdue
                          ? "Overdue"
                          : `${cell.taskCount} ${cell.taskCount === 1 ? "task" : "tasks"}`,
                    ].filter(Boolean);
                    const inMonth = day.getMonth() === month.getMonth();
                    const isToday = key === todayKey;
                    const isSelected = key === selectedKey;
                    const label = day.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    });
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityLabel={[label, ...spoken].join(", ")}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => onSelectDay(day)}
                        style={styles.cell}
                      >
                        <View
                          style={[
                            styles.dayChip,
                            isSelected
                              ? {
                                  backgroundColor: tint(accent, 0.18),
                                  borderColor: accent,
                                }
                              : isToday
                                ? styles.todayChip
                                : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dayNumber,
                              inMonth ? null : styles.outsideMonth,
                              isToday ? styles.todayNumber : null,
                            ]}
                          >
                            {day.getDate()}
                          </Text>
                        </View>
                        {/*
                      The day's events by title, then its birthdays (#4959)
                      in the chapter accent; an event required of the viewer
                      takes the accent too. One line under them folds what
                      didn't fit and counts the tasks due, red while any is
                      overdue.
                    */}
                        {cell.lines.map((line) => (
                          <Text
                            key={line.key}
                            testID={
                              line.kind === "event"
                                ? `event-title-${key}`
                                : `birthday-mark-${key}`
                            }
                            numberOfLines={1}
                            // Clipped, not "…": two more letters fit, as in
                            // Google Calendar's month.
                            ellipsizeMode="clip"
                            style={[
                              styles.cellLine,
                              line.kind === "birthday" ||
                              (line.kind === "event" && line.required)
                                ? {
                                    backgroundColor: tint(accent, 0.22),
                                    color: accent,
                                  }
                                : null,
                              inMonth ? null : styles.outsideLine,
                            ]}
                          >
                            {line.title}
                          </Text>
                        ))}
                        {footer.length > 0 ? (
                          <Text
                            testID={`cell-footer-${key}`}
                            numberOfLines={1}
                            style={[
                              styles.cellFooter,
                              cell.overdue ? styles.cellFooterOverdue : null,
                            ]}
                          >
                            {footer.join(" · ")}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </GestureDetector>

          <View>
            <DayHeading>
              {formatDayHeading(selectedDay.toISOString(), now) ?? selectedKey}
            </DayHeading>
            {dayEvents.length === 0 && dayTasks.length === 0 ? (
              <InlineNote>{emptyNote ?? "Nothing on this day."}</InlineNote>
            ) : (
              <>
                {dayEvents.map((event, index) => (
                  <EventRowFlat
                    key={event.id}
                    event={event}
                    cadence={selectSeriesCadence(events, event)}
                    now={now}
                    isFirst={index === 0}
                    onPress={() => onOpen(event.id)}
                  />
                ))}
                {dayTasks.map((item, index) => (
                  <CalendarTaskRow
                    key={item.key}
                    item={item}
                    isFirst={dayEvents.length === 0 && index === 0}
                    nameOf={nameOf}
                    onOpenTask={(taskId) => onOpenTask?.(taskId)}
                  />
                ))}
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/**
 * The 3 days or Day header: the day written out for Day, else the month
 * the days fall in ("November 2026", "Nov – Dec 2026", "Dec 2026 – Jan
 * 2027"), as Google Calendar's phone app heads its 3-day view. Day names
 * the year when it isn't this one, as the month heading always does.
 */
function rangeLabel(days: Date[], now: Date): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  if (days.length === 1) {
    return first.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      ...(first.getFullYear() === now.getFullYear()
        ? {}
        : { year: "numeric" as const }),
    });
  }
  if (
    first.getMonth() === last.getMonth() &&
    first.getFullYear() === last.getFullYear()
  ) {
    return first.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  const short = (day: Date) =>
    day.toLocaleDateString(undefined, { month: "short" });
  return first.getFullYear() === last.getFullYear()
    ? `${short(first)} – ${short(last)} ${last.getFullYear()}`
    : `${short(first)} ${first.getFullYear()} – ${short(last)} ${last.getFullYear()}`;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    root: {
      gap: tokens.spacing.md,
    },
    monthRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    monthLabel: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    grid: {
      gap: 0,
    },
    week: {
      flexDirection: "row",
    },
    weekday: {
      flex: 1,
      textAlign: "center",
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    cell: {
      flex: 1,
      minWidth: 0,
      alignItems: "stretch",
      gap: 2,
      // The day number and two lines; a day with more grows its week.
      minHeight: 64,
      paddingVertical: 3,
      paddingHorizontal: 1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    dayChip: {
      alignSelf: "center",
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "transparent",
    },
    todayChip: {
      borderColor: tokens.color.border.input,
    },
    dayNumber: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    todayNumber: {
      fontFamily: typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.bold,
      }).fontFamily,
    },
    outsideMonth: {
      color: tokens.color.text.mutedForeground,
    },
    cellLine: {
      // Below the caption role on purpose: a cell is a seventh of a phone,
      // and at 12.5 a title shows five letters (#4987).
      ...typeRole({ ...tokens.typography.role.caption, size: CELL_TEXT_SIZE }),
      lineHeight: CELL_LINE_HEIGHT,
      height: CELL_LINE_HEIGHT,
      paddingHorizontal: 2,
      borderRadius: 4,
      overflow: "hidden",
      backgroundColor: tokens.color.surface.card,
      color: tokens.color.text.foreground,
    },
    outsideLine: {
      opacity: 0.6,
    },
    cellFooter: {
      ...typeRole({ ...tokens.typography.role.caption, size: CELL_TEXT_SIZE }),
      lineHeight: CELL_LINE_HEIGHT,
      paddingHorizontal: 3,
      color: tokens.color.text.muted,
    },
    cellFooterOverdue: {
      color: tokens.color.semantic.destructiveText,
    },
  });
}
