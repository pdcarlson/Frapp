import { useMemo } from "react";
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
import { DisclosureGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
import { InlineNote } from "@/components/inline-note";
import { DayHeading, SectionHeaderSkeleton } from "@/components/list-section";
import { SkeletonBlock, SkeletonRegion } from "@/components/state-block";
import { EventRowFlat } from "@/components/events/event-rows";
import {
  CalendarTaskRow,
  type CalendarTaskMenuFor,
} from "@/components/events/calendar-tasks";
import type { ItemMenuHandle } from "@/components/item-actions-menu";
import { seriesCadenceOf, useRequiredOfViewer } from "@repo/hooks";
import type { CalendarItem } from "@repo/hooks/calendar-tasks";
import { useChapterBranding } from "@/lib/chapter-branding";
import { WEEKDAY_INITIALS } from "@/lib/calendar-weekdays";
import { monthCellSummary } from "@/lib/events/month-cell";
import type { EventRow } from "@/lib/events/select";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s06, the Calendar (#3792; the whole screen since #5310): a month grid that
 * writes each day's events by title in its cell (#4987, `monthCellSummary`),
 * the selected day's events listed under it, and the month moved with the
 * chevrons or a sideways swipe.
 *
 * Every occurrence of a series is marked on its own day. The grid is
 * `@repo/formatting`'s `monthGrid`, the weeks from the Sunday on or before
 * the 1st that web's calendar draws, less any week at the end with no day of
 * the month, so the phone's month is four to six weeks tall; a day is the
 * viewer's local calendar day (`localIsoDate`), as on web.
 *
 * The month and the selected day are the screen's state, not this
 * component's. The picked day's heading opens that day's hour grid
 * (`onOpenDay`, the Day screen), as Apple Calendar's month opens a day.
 */

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
  onOpenDay,
  eventMenuFor,
  taskMenuFor,
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
   * What the day list says when the chapter has nothing current or upcoming
   * (so a chapter whose events are all past gets it too), in place of
   * "Nothing on this day.".
   */
  emptyNote?: string | null;
  /**
   * Everything that isn't an event, by day: the member's tasks and the ones
   * they assigned (#4144), and members' shared birthdays (#4959). Listed
   * under the day's events.
   */
  tasksByDay?: Map<string, CalendarItem[]>;
  nameOf?: (userId: string) => string;
  /** The member's own task, opened on the task board. */
  onOpenTask?: (taskId: string) => void;
  /** The picked day's heading, pressed: that day's hour grid. */
  onOpenDay?: (day: Date) => void;
  /** An event row's long-press menu (`useEventMenu`, #5492). */
  eventMenuFor?: (event: EventRow) => ItemMenuHandle | null;
  /** A task row's (`useCalendarTaskMenu`, #5492). */
  taskMenuFor?: CalendarTaskMenuFor;
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
  const dayHeading = formatDayHeading(selectedDay, now) ?? selectedKey;

  const shiftMonth = (delta: number) => {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  };

  // JS-thread callbacks: turning the month is React state. The offsets let a
  // vertical drag fall through to the screen's scroll view, or the grid's.
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onEnd((event: { translationX: number }) => {
      if (event.translationX <= -SWIPE_DISTANCE) shiftMonth(1);
      else if (event.translationX >= SWIPE_DISTANCE) shiftMonth(-1);
    });

  const headerLabel = month.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  // `monthGrid` always gives six weeks; every week with no day of this
  // month (one for a five-week month, two for a four-week February) is
  // dropped, so its room goes to the day list.
  const weeks = Array.from({ length: 6 }, (_, row) =>
    days.slice(row * 7, row * 7 + 7),
  ).filter((week) => week.some((day) => day.getMonth() === month.getMonth()));

  return (
    <View style={styles.root}>
      <View style={styles.monthRow}>
        <IconButton label="Previous month" onPress={() => shiftMonth(-1)}>
          <ChevronGlyph direction="left" color={tokens.color.text.foreground} />
        </IconButton>
        <Text accessibilityRole="header" style={styles.monthLabel}>
          {headerLabel}
        </Text>
        <IconButton label="Next month" onPress={() => shiftMonth(1)}>
          <ChevronGlyph
            direction="right"
            color={tokens.color.text.foreground}
          />
        </IconButton>
      </View>

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
                // Spoken, a day names every event and birthday, not only
                // the ones its square has room for.
                const spoken = [
                  cell.eventTitles.length === 0
                    ? null
                    : `${cell.eventTitles.length} ${cell.eventTitles.length === 1 ? "event" : "events"}`,
                  ...cell.eventTitles,
                  cell.taskCount === 0
                    ? null
                    : `${cell.taskCount} ${cell.taskCount === 1 ? "task" : "tasks"}`,
                  cell.overdue ? "overdue" : null,
                  ...cell.birthdayNames.map((name) => `${name}'s birthday`),
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
                          inMonth ? null : styles.outsideLine,
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
        {onOpenDay ? (
          // The heading opens the day's hour grid, so it reads as a row
          // that opens: the chevron, as every row that opens draws one.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${dayHeading}, open the day`}
            onPress={() => onOpenDay(selectedDay)}
            testID="calendar-day-heading"
            style={styles.dayHeadingRow}
          >
            <DayHeading>{dayHeading}</DayHeading>
            <DisclosureGlyph
              color={tokens.color.text.mutedForeground}
              direction="right"
            />
          </Pressable>
        ) : (
          <DayHeading>{dayHeading}</DayHeading>
        )}
        {dayEvents.length === 0 && dayTasks.length === 0 ? (
          <InlineNote>{emptyNote ?? "Nothing on this day."}</InlineNote>
        ) : (
          <>
            {dayEvents.map((event, index) => (
              <EventRowFlat
                key={event.id}
                event={event}
                cadence={seriesCadenceOf(events, event)}
                now={now}
                isFirst={index === 0}
                onPress={() => onOpen(event.id)}
                menu={eventMenuFor?.(event) ?? null}
              />
            ))}
            {dayTasks.map((item, index) => (
              <CalendarTaskRow
                key={item.key}
                item={item}
                isFirst={dayEvents.length === 0 && index === 0}
                nameOf={nameOf}
                onOpenTask={(taskId) => onOpenTask?.(taskId)}
                menuFor={taskMenuFor}
              />
            ))}
          </>
        )}
      </View>
    </View>
  );
}

/** Weeks the loading month draws: most months' height. */
const SKELETON_WEEKS = 5;

/**
 * The Calendar's loading state, on the loaded month's own styles: the month
 * row with its title as a bar, the weekday initials (they never change, so
 * they are real), the weeks of cells with a bar where each day's number
 * sits, then the day heading over the day list. Which days carry events
 * depends on the data, so the cells stay empty.
 *
 * Exported so `components/screen-skeletons.spec.tsx` can pin its shape.
 */
export function EventsCalendarSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <SkeletonRegion label="Loading the calendar" style={styles.root}>
      <View style={styles.monthRow}>
        <SkeletonBlock width={tokens.spacing.xl} height={tokens.spacing.xl} />
        <SkeletonBlock width="40%" height={tokens.spacing.xl} />
        <SkeletonBlock width={tokens.spacing.xl} height={tokens.spacing.xl} />
      </View>
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
        {Array.from({ length: SKELETON_WEEKS }, (_, row) => (
          <View key={row} style={styles.week}>
            {WEEKDAY_INITIALS.map((_, column) => (
              <View key={column} style={styles.cell}>
                <SkeletonBlock
                  width={18}
                  height={tokens.spacing.md}
                  style={styles.skeletonDay}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
      <SectionHeaderSkeleton width="22%" />
    </SkeletonRegion>
  );
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
    skeletonDay: {
      alignSelf: "center",
      marginTop: 6,
    },
    dayHeadingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: tokens.touch.minimum,
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
