"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useAttendance(eventId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["attendance", eventId],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/events/{eventId}/attendance",
        { params: { path: { eventId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!eventId,
  });
}

export function useCheckIn() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await client.POST(
        "/v1/events/{eventId}/attendance/check-in",
        { params: { path: { eventId } }, body: {} },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, eventId) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", eventId] });
    },
  });
}

export function useUpdateAttendanceStatus() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      eventId,
      userId,
      body,
    }: {
      eventId: string;
      userId: string;
      body: {
        status: "PRESENT" | "EXCUSED" | "ABSENT" | "LATE";
        excuse_reason?: string;
      };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/events/{eventId}/attendance/{userId}",
        { params: { path: { eventId, userId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["attendance", variables.eventId],
      });
    },
  });
}

export function useAutoAbsent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await client.POST(
        "/v1/events/{eventId}/attendance/auto-absent",
        { params: { path: { eventId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, eventId) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", eventId] });
    },
  });
}
