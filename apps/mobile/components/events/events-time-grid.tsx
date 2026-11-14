import { useMemo, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { localIsoDate, parseInstant } from "@repo/formatting";
import { useRequiredOfViewer } from "@repo/hooks";
import type { CalendarItem } from "@repo/hooks/calendar-tasks";
import {
  blockGeometry,
  endsWithinDay,
  GRID_HOURS as HOURS,
  HOUR_HEIGHT,
  hourLabel,
  minuteOfDay,
  OPEN_AT_HOUR,
  timeGridColumns,
  TWO_LINE_MIN_HEIGHT,
} from "@repo/hooks/calendar-time-grid";
import { SignetTokens } from "@repo/theme/signet";
import { CalendarTaskChip } from "@/components/events/calendar-tasks";
import { useChapterBranding } from "@/lib/chapter-branding";
import { formatEventClock } from "@/lib/events/format";
import type { EventRow } from "@/lib/events/select";
import { typeRole, useFrappTheme } from "@/lib/theme";

const GUTTER = 44;

function longDay(day: Date): string {
  return day.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * The Calendar's 3 days and Day views on the phone (#4818), drawn as web's
 * Week and Day are (`apps/web/components/events/events-time-grid.tsx`) and as
 * Google Calendar's phone app draws them: an hour gutter at the left, a
 * column per day, each timed event a block at its start and as tall as it
 * lasts, events that overlap side by side (`@repo/hooks/calendar-time-grid`,
 * which web reads too), and an All day strip for the day's tasks and any
 * event of a whole day or more, on every day it covers. A red line marks the
 * time now in today's column. A member who can create events taps an hour
 * that isn't over to open New event starting then (`calendarHourStart`).
 *
 * `now` is the screen's ticking clock, which also decides which column is
 * today, so a tab left open past midnight moves both together.
 */
export function EventsTimeGrid({
  days,
  events,
  now,
  tasksByDay,
  onOpen,
  onOpenTask,
  onOpenDay,
  canCreate,
  onCreateAt,
}: {
  /** The columns, each at local midnight: three for 3 days, one for Day. */
  days: Date[];
  events: EventRow[];
  now: Date;
  tasksByDay: Map<string, CalendarItem[]>;
  onOpen: (id: string) => void;
  onOpenTask: (taskId: string) => void;
  /** A column's heading opens that day in the Day view (3 days only). */
  onOpenDay?: (day: Date) => void;
  canCreate: boolean;
  onCreateAt: (day: Date, hour: number) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const requiredOf = useRequiredOfViewer();
  const { height: windowHeight } = useWindowDimensions();
  const todayKey = localIsoDate(now);
  const hourLabels = useMemo(() => HOURS.map(hourLabel), []);

  const columns = useMemo(
    () => timeGridColumns(days, events, tasksByDay),
    [days, events, tasksByDay],
  );

  const hasStrip = columns.some(
    (column) => column.allDay.length > 0 || column.tasks.length > 0,
  );
  const isDayView = days.length === 1;

  // Opened at 8 AM once; stepping the range keeps where the member scrolled,
  // as web's does.
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  const gridHeight = Math.min(
    Math.max(windowHeight * 0.6, HOUR_HEIGHT * 6),
    HOURS.length * HOUR_HEIGHT,
  );

  const blockBorder = (event: EventRow) =>
    requiredOf(event.attendance) ? accent : tokens.color.border.control;
  // The accent edge is what marks a required event to the eye; a screen
  // reader hears it, as web's grid says it.
  const required = (event: EventRow) =>
    requiredOf(event.attendance) ? ", mandatory" : "";

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <View style={styles.gutter} />
        {columns.map(({ day, key }) => {
          const isToday = key === todayKey;
          const weekday = day.toLocaleDateString(undefined, {
            weekday: "short",
          });
          const heading = (
            <View
              style={[styles.heading, isDayView ? styles.headingStart : null]}
            >
              <Text
                style={[styles.weekday, isToday ? styles.weekdayToday : null]}
              >
                {weekday}
              </Text>
              <View
                style={[styles.dateChip, isToday ? styles.todayChip : null]}
              >
                <Text
                  style={[
                    styles.dateNumber,
                    isToday ? styles.dateNumberToday : null,
                  ]}
                >
                  {day.getDate()}
                </Text>
              </View>
            </View>
          );
          return onOpenDay && !isDayView ? (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`Open ${longDay(day)}`}
              onPress={() => onOpenDay(day)}
              style={styles.column}
            >
              {heading}
            </Pressable>
          ) : (
            <View
              key={key}
              accessible
              accessibilityRole="header"
              accessibilityLabel={longDay(day)}
              style={styles.column}
            >
              {heading}
            </View>
          );
        })}
      </View>

      {hasStrip ? (
        <View style={[styles.row, styles.strip]}>
          <View style={styles.gutter}>
            <Text style={styles.allDayLabel}>All day</Text>
          </View>
          {columns.map(({ key, allDay, tasks }) => (
            <View key={key} style={[styles.column, styles.stripColumn]}>
              {allDay.map((event) => (
                <Pressable
                  key={event.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${event.name}, all day${required(event)}`}
                  onPress={() => onOpen(event.id)}
                  style={({ pressed }) => [
                    styles.allDayChip,
                    { borderLeftColor: blockBorder(event) },
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.blockName}>
                    {event.name}
                  </Text>
                </Pressable>
              ))}
              {tasks.map((item) => (
                <CalendarTaskChip
                  key={item.key}
                  item={item}
                  onOpenTask={onOpenTask}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        testID="events-time-grid-scroll"
        nestedScrollEnabled
        style={{ height: gridHeight }}
        onLayout={() => {
          if (scrolled.current) return;
          scrolled.current = true;
          // A little above the hour, so its label isn't cut by the edge.
          scrollRef.current?.scrollTo({
            y: OPEN_AT_HOUR * HOUR_HEIGHT - 8,
            animated: false,
          });
        }}
      >
        <View style={[styles.row, { height: HOURS.length * HOUR_HEIGHT }]}>
          <View
            style={styles.gutter}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {HOURS.slice(1).map((hour) => (
              <Text
                key={hour}
                style={[styles.hourLabel, { top: hour * HOUR_HEIGHT - 8 }]}
              >
                {hourLabels[hour]}
              </Text>
            ))}
          </View>

          {columns.map(({ day, key, placed }) => {
            const isToday = key === todayKey;
            const dayLabel = longDay(day);
            return (
              <View
                key={key}
                testID={`time-grid-day-${key}`}
                style={[styles.column, styles.dayColumn]}
              >
                {HOURS.map((hour) => {
                  const lineStyle = [
                    styles.hourSlot,
                    { top: hour * HOUR_HEIGHT },
                    hour > 0 ? styles.hourLine : null,
                  ];
                  // An hour already over isn't offered: the form refuses a
                  // start that has passed.
                  const over =
                    new Date(
                      day.getFullYear(),
                      day.getMonth(),
                      day.getDate(),
                      hour + 1,
                    ) <= now;
                  if (!canCreate || over) {
                    return <View key={hour} style={lineStyle} />;
                  }
                  return (
                    <Pressable
                      key={hour}
                      accessibilityRole="button"
                      accessibilityLabel={`Create event on ${dayLabel} at ${hourLabels[hour]}`}
                      onPress={() => onCreateAt(day, hour)}
                      style={({ pressed }) => [
                        lineStyle,
                        pressed ? styles.pressed : null,
                      ]}
                    />
                  );
                })}

                {placed.map((span) => {
                  const event = span.item;
                  const { top, height } = blockGeometry(span);
                  const startLabel = formatEventClock(
                    parseInstant(event.start_time),
                  );
                  const endLabel = endsWithinDay(span)
                    ? formatEventClock(parseInstant(event.end_time))
                    : "";
                  const clock = endLabel
                    ? `${startLabel} – ${endLabel}`
                    : startLabel;
                  return (
                    <Pressable
                      key={`${event.id}-${key}`}
                      testID={`time-grid-block-${event.id}-${key}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${event.name}, ${clock}${required(event)}`}
                      onPress={() => onOpen(event.id)}
                      style={({ pressed }) => [
                        styles.block,
                        {
                          top,
                          height: height - 1,
                          left: `${(span.lane / span.lanes) * 100}%`,
                          width: `${100 / span.lanes}%`,
                          borderLeftColor: blockBorder(event),
                        },
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <Text numberOfLines={1} style={styles.blockName}>
                        {event.name}
                      </Text>
                      {height >= TWO_LINE_MIN_HEIGHT && clock ? (
                        <Text numberOfLines={1} style={styles.blockTime}>
                          {clock}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}

                {isToday ? (
                  <View
                    testID="time-grid-now"
                    pointerEvents="none"
                    style={[
                      styles.nowLine,
                      { top: (minuteOfDay(now) / 60) * HOUR_HEIGHT - 1 },
                    ]}
                  >
                    <View style={styles.nowDot} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const caption = tokens.typography.role.caption;
  return StyleSheet.create({
    root: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.card,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
    },
    gutter: {
      width: GUTTER,
    },
    column: {
      flex: 1,
      minWidth: 0,
    },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      paddingVertical: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
    },
    headingStart: {
      justifyContent: "flex-start",
      paddingHorizontal: tokens.spacing.sm,
    },
    weekday: {
      ...typeRole({ ...caption, weight: tokens.typography.weight.semibold }),
      color: tokens.color.text.mutedForeground,
    },
    weekdayToday: {
      color: tokens.color.text.foreground,
    },
    dateChip: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "transparent",
    },
    todayChip: {
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
    },
    dateNumber: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.foreground,
    },
    dateNumberToday: {
      fontFamily: typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }).fontFamily,
    },
    strip: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
      paddingVertical: 4,
    },
    stripColumn: {
      gap: 4,
      paddingHorizontal: 2,
    },
    allDayLabel: {
      ...typeRole(caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "right",
      paddingRight: 6,
      paddingTop: 3,
    },
    allDayChip: {
      paddingHorizontal: 4,
      paddingVertical: 3,
      borderRadius: 4,
      borderLeftWidth: 2,
      backgroundColor: tokens.color.surface.surface1,
    },
    hourLabel: {
      position: "absolute",
      right: 6,
      ...typeRole(caption),
      color: tokens.color.text.mutedForeground,
    },
    dayColumn: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: tokens.color.border.hairline,
    },
    hourSlot: {
      position: "absolute",
      left: 0,
      right: 0,
      height: HOUR_HEIGHT,
    },
    hourLine: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    pressed: {
      backgroundColor: tokens.color.surface.card,
    },
    block: {
      position: "absolute",
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 4,
      borderLeftWidth: 2,
      borderWidth: 1,
      borderColor: tokens.color.surface.background,
      backgroundColor: tokens.color.surface.surface1,
      overflow: "hidden",
    },
    blockName: {
      ...typeRole({ ...caption, weight: tokens.typography.weight.semibold }),
      color: tokens.color.text.foreground,
    },
    blockTime: {
      ...typeRole(caption),
      color: tokens.color.text.mutedForeground,
    },
    nowLine: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: tokens.color.semantic.destructive,
    },
    nowDot: {
      position: "absolute",
      left: -4,
      top: -3,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: tokens.color.semantic.destructive,
    },
  });
}
