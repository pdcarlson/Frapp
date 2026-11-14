"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Activity, ActivityReminder } from "./activity-rows";
import { activityKeys } from "./use-activity";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * "Remind me about this" on a chat message (#4957). The presets are Slack's
 * own ("Remind me about this": in 20 minutes, 1 hour, 3 hours, tomorrow,
 * next week), so a member who knows that menu knows this one; "Custom…" is
 * each client's date and time picker.
 */
export type MessageReminderPresetId =
  "20m" | "1h" | "3h" | "tomorrow" | "next-week";

export interface MessageReminderPreset {
  id: MessageReminderPresetId;
  label: string;
}

export const MESSAGE_REMINDER_PRESETS: readonly MessageReminderPreset[] = [
  { id: "20m", label: "In 20 minutes" },
  { id: "1h", label: "In 1 hour" },
  { id: "3h", label: "In 3 hours" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "next-week", label: "Next week" },
];

/** What the message menu's row says, on both clients. */
export const MESSAGE_REMINDER_LABEL = "Remind me about this";

/** The hour of day "Tomorrow" and "Next week" land on, as Slack's do. */
const REMINDER_MORNING_HOUR = 9;

/**
 * When a preset reminds, in the member's own time zone: "Tomorrow" is 9:00
 * AM tomorrow, "Next week" 9:00 AM next Monday.
 */
export function messageReminderPresetTime(
  id: MessageReminderPresetId,
  now: Date = new Date(),
): Date {
  const minutes = (count: number) => new Date(now.getTime() + count * 60_000);
  switch (id) {
    case "20m":
      return minutes(20);
    case "1h":
      return minutes(60);
    case "3h":
      return minutes(180);
    case "tomorrow":
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        REMINDER_MORNING_HOUR,
      );
    case "next-week": {
      // Days to next Monday: 1 on a Sunday, 7 on a Monday.
      const ahead = (8 - now.getDay()) % 7 || 7;
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + ahead,
        REMINDER_MORNING_HOUR,
      );
    }
  }
}

/** The member's own pending reminder on a message, read off Activity's cache. */
export function findMessageReminder(
  activity: Pick<Activity, "reminders"> | undefined,
  messageId: string,
): ActivityReminder | null {
  return (
    activity?.reminders?.find((row) => row.message_id === messageId) ?? null
  );
}

function useReminderWrite<TVariables>(
  name: string,
  write: (variables: TVariables) => Promise<void>,
  drop: ((variables: TVariables) => string) | null,
) {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["message-reminder-write", name],
    mutationFn: write,
    // Done takes the row off Activity at once and puts it back on a failure,
    // as a link's Done does.
    onMutate: async (variables: TVariables) => {
      if (!drop || !chapterId) return null;
      const messageId = drop(variables);
      const queryKey = activityKeys.chapter(chapterId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<Activity>(queryKey);
      if (!previous?.reminders) return null;
      queryClient.setQueryData<Activity>(queryKey, {
        ...previous,
        reminders: previous.reminders.filter(
          (row) => row.message_id !== messageId,
        ),
      });
      return { queryKey, previous };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previous);
    },
    onSettled: () => {
      if (!chapterId) return;
      if (
        queryClient.isMutating({ mutationKey: ["message-reminder-write"] }) > 1
      ) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: activityKeys.chapter(chapterId),
        exact: true,
      });
    },
  });
}

/**
 * Sets the member's reminder on a message, or moves it (Activity's snooze is
 * the same call): `PUT /v1/reminders/messages/{messageId}`.
 */
export function useSetMessageReminder() {
  const client = useFrappClient();
  return useReminderWrite<{ messageId: string; remindAt: Date }>(
    "set",
    async ({ messageId, remindAt }) => {
      const { error } = await client.PUT("/v1/reminders/messages/{messageId}", {
        params: { path: { messageId } },
        body: { remind_at: remindAt.toISOString() },
      });
      if (error) throw error;
    },
    null,
  );
}

/** Clears the member's reminder: Done on Activity, or cancel. */
export function useClearMessageReminder() {
  const client = useFrappClient();
  return useReminderWrite<string>(
    "clear",
    async (messageId) => {
      const { error } = await client.DELETE(
        "/v1/reminders/messages/{messageId}",
        { params: { path: { messageId } } },
      );
      if (error) throw error;
    },
    (messageId) => messageId,
  );
}
