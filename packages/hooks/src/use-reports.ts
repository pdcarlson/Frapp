"use client";

import { useMutation } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useAttendanceReport() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({
      format = "json",
      body,
    }: {
      format?: string;
      body: {
        event_id?: string;
        start_date?: string;
        end_date?: string;
      };
    }) => {
      const { data, error } = await client.POST("/v1/reports/attendance", {
        params: { query: { format } },
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function usePointsReport() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({
      format = "json",
      body,
    }: {
      format?: string;
      body: { user_id?: string; window?: string };
    }) => {
      const { data, error } = await client.POST("/v1/reports/points", {
        params: { query: { format } },
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useRosterReport() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({ format = "json" }: { format?: string } = {}) => {
      const { data, error } = await client.POST("/v1/reports/roster", {
        params: { query: { format } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useServiceReport() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({
      format = "json",
      body,
    }: {
      format?: string;
      body: {
        user_id?: string;
        start_date?: string;
        end_date?: string;
      };
    }) => {
      const { data, error } = await client.POST("/v1/reports/service", {
        params: { query: { format } },
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}
