"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import {
  isRequestTimeout,
  serverMessageOf,
  type components,
} from "@repo/api-sdk";

export function useEvents(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["events", chapterId],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/events", { signal });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

export function useEvent(id: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["events", chapterId, id],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/events/{id}", {
        signal,
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!id,
  });
}

/**
 * Why `useCreateEvent` rejected when the server's answer was lost: the event
 * may exist. Callers show it as is.
 */
/** Gateway statuses: the edge answered, so the origin's outcome is unknown. */
const LOST_ANSWER_STATUSES = new Set([502, 503, 504]);

export const EVENT_CREATE_UNCONFIRMED =
  "The server didn't confirm it. Check the Events calendar before trying again: the event may already be there.";

export function useCreateEvent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["events", "create-event"],
    mutationFn: async (body: {
      name: string;
      description?: string;
      location?: string;
      start_time: string;
      end_time: string;
      point_value: number;
      is_mandatory: boolean;
      recurrence_rule?: string;
      // Attendance by role (`@repo/validation` § event-attendance). Send
      // `others_invited` whenever a role list is sent.
      required_role_ids?: string[];
      optional_role_ids?: string[];
      excluded_role_ids?: string[];
      others_invited?: boolean;
      notes?: string;
      // Mirrors CreateEventDto: at least 3 vertices, and the field is omitted
      // rather than sent empty when the event has no geofence (@ArrayMinSize(3)
      // makes [] a 400 here, unlike on update).
      check_in_zone?: components["schemas"]["GeofenceCoordinateDto"][];
      check_in_zone_name?: string;
      // Minutes before the start that check-in opens; the server defaults it.
      check_in_opens_minutes?: number;
      // One of the chapter's event types (`useEventTypes`), or omitted.
      event_type_id?: string;
      // Both or neither: posts the event's card to this chat channel. The API
      // refuses either key on an event that keeps anyone out.
      channel_id?: string;
      client_message_id?: string;
    }) => {
      // An answer that was lost is not a refusal: the origin may or may not
      // have written the row, and the route has no dedupe, so it rejects as
      // unconfirmed rather than "failed", which invites a duplicate (#1717).
      // Three shapes: the client giving up on the answer (#3433), a gateway's
      // own 502/503/504 whatever body it carries, and any other non-2xx that
      // carries no message of the API's (an empty body, or an edge's page:
      // the client hands both back as a bare `{ statusCode }`, #3394).
      const result = await client
        .POST("/v1/events", { body })
        .catch((thrown: unknown) => {
          if (isRequestTimeout(thrown)) {
            throw new Error(EVENT_CREATE_UNCONFIRMED);
          }
          throw thrown;
        });
      const { data, error, response } = result;
      if (
        !response.ok &&
        (LOST_ANSWER_STATUSES.has(response.status) ||
          serverMessageOf(error) === null)
      ) {
        throw new Error(EVENT_CREATE_UNCONFIRMED);
      }
      if (error) throw error;
      return data;
    },
    // Not even web's default retry of a lost answer: the route has no dedupe,
    // so a repeat of a create that landed is a second event (#1717). The
    // member is told to check the calendar instead.
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
    onError: (error) => {
      // The event may exist, and the copy says to check for it: refetch the
      // list so a cached one doesn't hide it.
      if (
        error instanceof Error &&
        error.message === EVENT_CREATE_UNCONFIRMED
      ) {
        void queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
      }
    },
  });
}

export function useUpdateEvent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["events", "update-event"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        description?: string;
        location?: string;
        start_time?: string;
        end_time?: string;
        point_value?: number;
        is_mandatory?: boolean;
        // `null` ends a series (`UpdateEventDto` lets `@IsOptional` pass it).
        recurrence_rule?: string | null;
        required_role_ids?: string[];
        optional_role_ids?: string[];
        excluded_role_ids?: string[];
        others_invited?: boolean;
        notes?: string;
        // Mirrors UpdateEventDto, which deliberately drops @ArrayMinSize so an
        // empty array clears a stored zone.
        check_in_zone?: components["schemas"]["GeofenceCoordinateDto"][];
        check_in_zone_name?: string;
        check_in_opens_minutes?: number;
        // `null` clears the type; omitted leaves it.
        event_type_id?: string | null;
        // Which rows of a repeating series the edit reaches
        // (`spec/behavior/events.md` § Recurrence edit and cancellation scope).
        scope?: "instance" | "series";
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/events/{id}", {
        params: { path: { id } },
        // The generated type has no `null` for the rule; the DTO accepts it.
        body: body as components["schemas"]["UpdateEventDto"],
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
  });
}

export function useDeleteEvent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["events", "delete-event"],
    // A bare id deletes one event; `scope: "series"` cancels a repeating
    // series from now forward.
    mutationFn: async (
      target: string | { id: string; scope?: "instance" | "series" },
    ) => {
      const { id, scope } =
        typeof target === "string" ? { id: target, scope: undefined } : target;
      const { data, error } = await client.DELETE("/v1/events/{id}", {
        params: { path: { id }, ...(scope ? { query: { scope } } : {}) },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
  });
}
