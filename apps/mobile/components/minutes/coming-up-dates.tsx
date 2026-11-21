import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import {
  useChapterRoster,
  useClearMeetingDateReminder,
  useComingUpTracking,
  useMeetingDateReminders,
  useMemberDisplayNames,
  useSetMeetingDateReminder,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  COMING_UP_COPY,
  comingUpChips,
  comingUpCopyText,
  comingUpEventTimes,
  comingUpIsAhead,
  comingUpMenu,
  comingUpReminderFor,
  comingUpReminderTime,
  suggestTaskOwner,
  type ComingUpMenuAction,
  type MeetingContent,
} from "@repo/validation";
import {
  CalendarPlusGlyph,
  CheckGlyph,
  CloseGlyph,
  CopyGlyph,
  ForwardGlyph,
  MoreGlyph,
} from "@/components/control-glyphs";
import { BellGlyph } from "@/components/notifications/push-ask";
import { NewEventSheet } from "@/components/events/new-event-sheet";
import { MinutesDates } from "@/components/minutes/minutes-body";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import {
  useItemMenu,
  type ItemMenuAction,
} from "@/components/item-actions-menu";
import { selectionHaptic } from "@/lib/haptics";
import { emptyEventDraft, type NewEventDraft } from "@/lib/events/create-event";
import type { TaskPrefill } from "@/lib/tasks/create-task";
import { focusReturnOf } from "@/lib/overlay";
import { typeRole, useFrappTheme } from "@/lib/theme";

type DateItem = MeetingContent["dates"][number];

const GLYPHS: Record<ComingUpMenuAction, (color: string) => React.ReactNode> = {
  remindMe: (color) => <BellGlyph color={color} size={20} />,
  cancelReminder: (color) => <CloseGlyph color={color} />,
  openEvent: (color) => <ForwardGlyph color={color} />,
  addToCalendar: (color) => <CalendarPlusGlyph color={color} />,
  makeTask: (color) => <CheckGlyph color={color} />,
  copyDate: (color) => <CopyGlyph color={color} />,
};

/**
 * Coming up, tracked (#5672; Paul, 2026-11-19, who "loves the Coming up
 * dates and wants them tracked"). Each date says what already tracks it, "On
 * the calendar" and "Task · Jake" as chips that open the event or the task,
 * and its ⋯ turns it into one: Open the event (or Add to calendar, the New
 * event sheet on that day with the date's words), Make a task (the task
 * sheet, due that day, Who guessed from the words as suggested tasks guess
 * it) and Copy date. Remind me, for every reader, pushes the date to them
 * the evening before (or that morning), and a "Reminder · December 3, 6 PM"
 * chip says it is set. Web's `coming-up-dates.tsx` draws the same chips and
 * menu in the same order, from `@repo/validation`'s `coming-up-tracking.ts`.
 *
 * The phone has no toast, so a set or a cancel confirms as Save does: a tick
 * of haptics, the chip appearing or going, and the words said to a screen
 * reader. A failed write says so in an alert.
 */
export function ComingUpDates({
  meetingId,
  dates,
  viewerId,
}: {
  meetingId: string;
  dates: MeetingContent["dates"];
  viewerId: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { tracking, canCreateEvents, canManageTasks } =
    useComingUpTracking(dates);
  const names = useMemberDisplayNames();
  const roster = useChapterRoster();
  const itemMenu = useItemMenu();
  const reminders = useMeetingDateReminders(meetingId);
  const setReminder = useSetMeetingDateReminder(meetingId);
  const clearReminder = useClearMeetingDateReminder(meetingId);
  const reminderOn = (item: DateItem) =>
    comingUpReminderFor(reminders.data ?? [], item);

  const [eventFor, setEventFor] = useState<{
    key: string;
    template: NewEventDraft;
  } | null>(null);
  const eventRef = useRef<BottomSheetModal>(null);
  useEffect(() => {
    if (eventFor) eventRef.current?.present();
  }, [eventFor]);
  const [taskFor, setTaskFor] = useState<{
    key: string;
    prefill: TaskPrefill;
  } | null>(null);
  const taskRef = useRef<BottomSheetModal>(null);
  useEffect(() => {
    if (taskFor) taskRef.current?.present();
  }, [taskFor]);

  function run(action: ComingUpMenuAction, item: DateItem, index: number) {
    const key = `${item.date}-${index}`;
    if (action === "remindMe") {
      const at = comingUpReminderTime(item.date);
      if (!at) return;
      selectionHaptic();
      setReminder
        .mutateAsync({ date: item.date, text: item.text, remindAt: at })
        .then(
          () => {
            AccessibilityInfo.announceForAccessibility(
              COMING_UP_COPY.reminderSet(at),
            );
          },
          (error: unknown) => {
            Alert.alert(COMING_UP_COPY.reminderSetFailed, errorCopy(error));
          },
        );
    } else if (action === "cancelReminder") {
      const reminder = reminderOn(item);
      if (!reminder) return;
      selectionHaptic();
      clearReminder.mutateAsync(reminder.id).then(
        () => {
          AccessibilityInfo.announceForAccessibility(
            COMING_UP_COPY.reminderCanceled,
          );
        },
        (error: unknown) => {
          Alert.alert(COMING_UP_COPY.reminderCancelFailed, errorCopy(error));
        },
      );
    } else if (action === "openEvent") {
      const event = tracking[index]?.event;
      if (event) {
        router.push({ pathname: "/event-details", params: { id: event.id } });
      }
    } else if (action === "addToCalendar") {
      const times = comingUpEventTimes(item.date);
      if (!times) return;
      setEventFor({
        key,
        template: {
          ...emptyEventDraft(),
          name: item.text,
          start: times.start,
          end: times.end,
        },
      });
    } else if (action === "makeTask") {
      const owner = suggestTaskOwner(item.text, roster.data ?? []);
      setTaskFor({
        key,
        prefill: {
          title: item.text,
          description: null,
          who: owner ? { kind: "person", userId: owner } : null,
          pointsInput: "",
          proofKind: "none",
          subtasks: [],
          due: { kind: "date", date: item.date },
          dueTime: null,
          followedBy: null,
        },
      });
    } else {
      void Clipboard.setStringAsync(comingUpCopyText(item)).then(
        () => {
          selectionHaptic();
          AccessibilityInfo.announceForAccessibility(COMING_UP_COPY.copied);
        },
        () => {
          AccessibilityInfo.announceForAccessibility(COMING_UP_COPY.copyFailed);
        },
      );
    }
  }

  return (
    <>
      <MinutesDates
        dates={dates}
        below={(item, index) => {
          const track = tracking[index] ?? { event: null, tasks: [] };
          const chips = comingUpChips(
            track,
            names.nameFor,
            viewerId,
            reminderOn(item),
          );
          if (chips.length === 0) return null;
          return (
            <View style={styles.chips}>
              {chips.map((chip) => {
                const open =
                  chip.key === "event" && track.event
                    ? () =>
                        router.push({
                          pathname: "/event-details",
                          params: { id: track.event!.id },
                        })
                    : chip.key === "task" && track.tasks[0]
                      ? () =>
                          router.push({
                            pathname: "/task-details",
                            params: { id: track.tasks[0]!.id },
                          })
                      : undefined;
                return (
                  <Pressable
                    key={chip.key}
                    accessibilityRole={open ? "link" : undefined}
                    disabled={!open}
                    onPress={open}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.chipText}>{chip.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        }}
        trailing={(item, index) => {
          const actions: ItemMenuAction[] = comingUpMenu({
            hasEvent: !!tracking[index]?.event,
            upcoming: comingUpIsAhead(item.date),
            canCreateEvents,
            canManageTasks,
            hasReminder: !!reminderOn(item),
            canRemind: comingUpReminderTime(item.date) !== null,
          }).map((entry) => ({
            key: entry.action,
            label: entry.label,
            glyph: GLYPHS[entry.action],
            run: () => run(entry.action, item, index),
          }));
          const menu = itemMenu.handleFor({ title: item.text, actions });
          if (!menu) return null;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COMING_UP_COPY.more(item.text)}
              // 36pt drawn against the 44pt minimum.
              hitSlop={4}
              onPress={(event) =>
                menu.open(event?.nativeEvent?.pageY, focusReturnOf(event))
              }
              style={({ pressed }) => [
                styles.more,
                pressed ? styles.pressed : null,
              ]}
            >
              <MoreGlyph color={tokens.color.text.mutedForeground} />
            </Pressable>
          );
        }}
      />
      {itemMenu.element}
      {eventFor ? (
        <NewEventSheet
          key={eventFor.key}
          ref={eventRef}
          template={eventFor.template}
          onClosed={() => setEventFor(null)}
        />
      ) : null}
      {taskFor ? (
        <NewTaskSheet
          key={taskFor.key}
          ref={taskRef}
          prefill={taskFor.prefill}
          onClosed={() => setTaskFor(null)}
        />
      ) : null}
    </>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.xs,
      marginTop: tokens.spacing.xs,
    },
    chip: {
      height: 24,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    more: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.control,
      alignSelf: "flex-start",
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
