"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** One of the viewer's reminders on a minutes' Coming up date (#5672). */
export type MeetingDateReminder =
  components["schemas"]["MeetingDateReminderDto"];

const remindersKey = (
  chapterId: string | null | undefined,
  meetingId: string,
) => ["meetings", chapterId, "date-reminders", meetingId] as const;

/**
 * The viewer's reminders still waiting on these minutes' Coming up dates
 * (`meetings.md` § Reading minutes → Coming up, tracked). Empty when the
 * meetings module is off or the minutes can't be read: nothing to show.
 */
export function useMeetingDateReminders(meetingId: string | null) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: remindersKey(chapterId, meetingId ?? ""),
    queryFn: async ({ signal }): Promise<MeetingDateReminder[]> => {
      const { data, error, response } = await client.GET(
        "/v1/meetings/{id}/date-reminders",
        { params: { path: { id: meetingId! } }, signal },
      );
      if (response.status === 404 || response.status === 403) return [];
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!chapterId && !!meetingId,
  });
}

/** Remind the viewer about one of the minutes' dates, or move that reminder. */
export function useSetMeetingDateReminder(meetingId: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["meetings", "date-reminder", "set"],
    mutationFn: async (input: {
      date: string;
      text: string;
      remindAt: Date;
    }): Promise<MeetingDateReminder> => {
      const { data, error } = await client.PUT(
        "/v1/meetings/{id}/date-reminders",
        {
          params: { path: { id: meetingId } },
          body: {
            date: input.date,
            text: input.text.trim(),
            remind_at: input.remindAt.toISOString(),
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<MeetingDateReminder[]>(
        remindersKey(chapterId, meetingId),
        (rows = []) =>
          [
            ...rows.filter(
              (row) =>
                row.id !== saved.id &&
                !(row.date === saved.date && row.text === saved.text),
            ),
            saved,
          ].sort((a, b) => a.remind_at.localeCompare(b.remind_at)),
      );
    },
  });
}

/** Cancel one of the viewer's date reminders. */
export function useClearMeetingDateReminder(meetingId: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["meetings", "date-reminder", "clear"],
    mutationFn: async (reminderId: string): Promise<void> => {
      const { error } = await client.DELETE(
        "/v1/meetings/{id}/date-reminders/{reminderId}",
        { params: { path: { id: meetingId, reminderId } } },
      );
      if (error) throw error;
    },
    onSuccess: (_done, reminderId) => {
      queryClient.setQueryData<MeetingDateReminder[]>(
        remindersKey(chapterId, meetingId),
        (rows = []) => rows.filter((row) => row.id !== reminderId),
      );
    },
  });
}
