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
import type { CalendarTask } from "@repo/hooks/calendar-tasks";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectSeriesCadence, type EventRow } from "@/lib/events/select";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s06's Calendar view (#3792): a month grid with a dot under each day that has
 * an event, the selected day's events listed under it, and the month moved
 * with the chevrons or a sideways swipe.
 *
 * Every occurrence of a series is marked on its own day, while the List draws
 * a series once (#3792 § Notes). The grid is `@repo/formatting`'s `monthGrid`,
 * the same six weeks from the Sunday on or before the 1st that web's calendar
 * draws (web moves onto the shared helper in #3822); a day is the viewer's
 * local calendar day (`localIsoDate`), as on web.
 *
 * The month and the selected day are the screen's state, not this
 * component's, so switching to List and back keeps the member's place.
 */

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** How far a finger travels sideways before a swipe turns the month. */
const SWIPE_DISTANCE = 48;

const NO_TASKS = new Map<string, CalendarTask[]>();
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
   * The member's tasks and the ones they assigned, by due day, narrowed to
   * the kinds switched on (#4144). Listed under the day's events.
   */
  tasksByDay?: Map<string, CalendarTask[]>;
  nameOf?: (userId: string) => string;
  /** The member's own task, opened on the task board. */
  onOpenTask?: (taskId: string) => void;
  /** The Events / My tasks / Assigned by me chips, under the month. */
  layerChips?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
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

  // JS-thread callbacks: turning the month is React state. The offsets let a
  // vertical drag fall through to the screen's scroll view.
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onEnd((event: { translationX: number }) => {
      if (event.translationX <= -SWIPE_DISTANCE) shiftMonth(1);
      else if (event.translationX >= SWIPE_DISTANCE) shiftMonth(-1);
    });

  const monthLabel = month.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const weeks = Array.from({ length: 6 }, (_, row) =>
    days.slice(row * 7, row * 7 + 7),
  );

  return (
    <View style={styles.root}>
      <View style={styles.monthRow}>
        <IconButton label="Previous month" onPress={() => shiftMonth(-1)}>
          <ChevronGlyph direction="left" color={tokens.color.text.foreground} />
        </IconButton>
        <Text accessibilityRole="header" style={styles.monthLabel}>
          {monthLabel}
        </Text>
        <IconButton label="Next month" onPress={() => shiftMonth(1)}>
          <ChevronGlyph
            direction="right"
            color={tokens.color.text.foreground}
          />
        </IconButton>
      </View>

      {layerChips}

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
                const count = byDay.get(key)?.length ?? 0;
                const cellTasks = tasksByDay.get(key) ?? [];
                const taskCount = cellTasks.length;
                const hasOverdue = cellTasks.some(
                  (item) => item.state === "overdue",
                );
                const counts = [
                  count === 0
                    ? null
                    : `${count} ${count === 1 ? "event" : "events"}`,
                  taskCount === 0
                    ? null
                    : `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`,
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
                    accessibilityLabel={[label, ...counts].join(", ")}
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
                      A dot is an event, a ring is something due: red while
                      any of the day's tasks is overdue.
                    */}
                    <View style={styles.marks}>
                      {count > 0 ? (
                        <View
                          testID={`event-dot-${key}`}
                          style={[
                            styles.dot,
                            {
                              backgroundColor:
                                tokens.color.text.mutedForeground,
                            },
                          ]}
                        />
                      ) : null}
                      {taskCount > 0 ? (
                        <View
                          testID={`task-ring-${key}`}
                          style={[
                            styles.dot,
                            styles.ring,
                            hasOverdue
                              ? {
                                  borderColor:
                                    tokens.color.semantic.destructiveText,
                                }
                              : null,
                          ]}
                        />
                      ) : null}
                    </View>
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
    </View>
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
    monthLabel: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    grid: {
      gap: tokens.spacing.xs,
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
      alignItems: "center",
      gap: 2,
      minHeight: tokens.touch.minimum,
      paddingVertical: 2,
    },
    dayChip: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "transparent",
    },
    todayChip: {
      borderColor: tokens.color.border.input,
    },
    dayNumber: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    todayNumber: {
      fontFamily: typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }).fontFamily,
    },
    outsideMonth: {
      color: tokens.color.text.mutedForeground,
    },
    marks: {
      flexDirection: "row",
      gap: 2,
      height: 5,
    },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
    },
    ring: {
      borderWidth: 1,
      borderColor: tokens.color.text.mutedForeground,
    },
  });
}
