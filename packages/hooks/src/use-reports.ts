"use client";

import { useMutation } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

/**
 * Export format accepted by every /v1/reports route.
 *
 * - `json` (default) — report rows.
 * - `csv` — inline CSV body.
 * - `pdf` — branded document stored privately; the response is a
 *   {@link ReportExportEnvelope} carrying a one-hour signed download URL.
 */
export type ReportFormat = "json" | "csv" | "pdf";

/** Shape returned by any report route when `format: "pdf"`. */
export interface ReportExportEnvelope {
  url: string;
  expires_at: string;
  expires_in: number;
  filename: string;
  storage_path: string;
  row_count: number;
  /**
   * True when the report hit its row ceiling, so the document is not a
   * complete record of the chapter. `row_count` describes what was printed,
   * not what matched, so it cannot answer this on its own.
   */
  truncated: boolean;
  /** The ceiling `truncated` refers to. */
  row_limit: number;
}

/** Narrow a report response to the PDF envelope. */
export function isReportExportEnvelope(
  payload: unknown,
): payload is ReportExportEnvelope {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as ReportExportEnvelope).url === "string" &&
    typeof (payload as ReportExportEnvelope).filename === "string"
  );
}

export function useAttendanceReport() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({
      format = "json",
      body,
    }: {
      format?: ReportFormat;
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
      format?: ReportFormat;
      body: { user_id?: string; window?: "all" | "semester" | "month" };
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
    mutationFn: async ({ format = "json" }: { format?: ReportFormat } = {}) => {
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
      format?: ReportFormat;
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
