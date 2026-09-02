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
  /**
   * What was cut, when the row count alone does not say it — a roster whose
   * point balances were summed from a truncated read is the right length, so
   * `row_limit` on its own would describe a cut the document never took.
   */
  truncation_note?: string;
}

/**
 * Whether a `json`/`csv` report was cut short, read off the response headers.
 *
 * Those two formats keep bare bodies — an array and CSV bytes — so external
 * parsers are unaffected, which leaves headers as the only channel. That only
 * helps if a caller actually reads them: openapi-fetch hands back `response`
 * alongside `data`, and dropping it is what makes a truncated report look
 * complete on the surface most likely to forward one.
 */
export interface ReportTruncation {
  truncated: boolean;
  /** The ceiling `truncated` refers to. */
  rowLimit: number | null;
  /** What was cut, when the row count alone does not say it. */
  note: string | null;
}

function readTruncation(response: Response): ReportTruncation {
  const rawLimit = response.headers.get("X-Report-Row-Limit");
  return {
    truncated: response.headers.get("X-Report-Truncated") === "true",
    // Matched as plain decimal digits rather than handed to `Number`, which is
    // lenient in ways this header should not be: it reads `""` and `" "` as 0,
    // `"0x10"` as 16, and `"-5"` as -5. The API only ever sends a positive
    // integer, so anything else is a rewrite in transit and reads as absent —
    // "Capped at -5 rows" is worse than saying only that the report is short.
    rowLimit: /^[1-9][0-9]*$/.test(rawLimit ?? "") ? Number(rawLimit) : null,
    note: response.headers.get("X-Report-Truncation-Note"),
  };
}

/** A report payload plus whether the API said it was incomplete. */
export interface ReportResponse<T> {
  payload: T;
  truncation: ReportTruncation;
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
      const { data, error, response } = await client.POST(
        "/v1/reports/attendance",
        {
          params: { query: { format } },
          body,
        },
      );
      if (error) throw error;
      return { payload: data, truncation: readTruncation(response) };
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
      body: {
        user_id?: string;
        window?: "all" | "semester" | "month";
        semester_archive_id?: string;
      };
    }) => {
      const { data, error, response } = await client.POST(
        "/v1/reports/points",
        {
          params: { query: { format } },
          body,
        },
      );
      if (error) throw error;
      return { payload: data, truncation: readTruncation(response) };
    },
  });
}

export function useRosterReport() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async ({ format = "json" }: { format?: ReportFormat } = {}) => {
      const { data, error, response } = await client.POST(
        "/v1/reports/roster",
        {
          params: { query: { format } },
        },
      );
      if (error) throw error;
      return { payload: data, truncation: readTruncation(response) };
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
      const { data, error, response } = await client.POST(
        "/v1/reports/service",
        {
          params: { query: { format } },
          body,
        },
      );
      if (error) throw error;
      return { payload: data, truncation: readTruncation(response) };
    },
  });
}
