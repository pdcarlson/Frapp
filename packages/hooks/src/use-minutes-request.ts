"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** An event's unposted minutes the caller may ask for (#5471). */
export type MinutesRequestState =
  components["schemas"]["MinutesRequestStateDto"];

const minutesRequestKey = (
  chapterId: string | null | undefined,
  eventId: string,
) => ["meetings", chapterId, "minutes-request", eventId] as const;

/**
 * Whether the caller may ask for the event's unposted minutes, and whether
 * they have (`meetings.md` § Asking for minutes): one row, or none when
 * there is nothing they may ask for.
 */
export function useMinutesRequest(options: {
  eventId: string;
  enabled?: boolean;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const { eventId } = options;
  return useQuery({
    queryKey: minutesRequestKey(chapterId, eventId),
    queryFn: async ({ signal }): Promise<MinutesRequestState | null> => {
      const { data, error, response } = await client.GET(
        "/v1/minutes-requests",
        { params: { query: { event_id: eventId } }, signal },
      );
      // The meetings module off, or no longer a member: nothing to ask for.
      if (response.status === 404 || response.status === 403) return null;
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: (options.enabled ?? true) && !!chapterId && !!eventId,
  });
}

/** Ask for unposted minutes, which pings whoever can post them. */
export function useRequestMinutes() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["meetings", "minutes-request"],
    mutationFn: async (meetingId: string): Promise<MinutesRequestState> => {
      const { data, error } = await client.POST(
        "/v1/meetings/{id}/minutes-request",
        { params: { path: { id: meetingId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (state) => {
      queryClient.setQueryData(
        minutesRequestKey(chapterId, state.event_id),
        state,
      );
    },
    onError: () => {
      // Posted in the meantime, or the meeting moved: read it again.
      void queryClient.invalidateQueries({
        queryKey: ["meetings", chapterId, "minutes-request"],
      });
    },
  });
}
