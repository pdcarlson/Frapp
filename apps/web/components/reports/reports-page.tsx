"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import {
  isReportExportEnvelope,
  useAttendanceReport,
  usePointsReport,
  useRosterReport,
  useServiceReport,
  type ReportFormat,
  type ReportResponse,
  type ReportTruncation,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";

type ReportKind = "attendance" | "points" | "roster" | "service";

const reportLabel: Record<ReportKind, string> = {
  attendance: "Attendance",
  points: "Points",
  roster: "Member roster",
  service: "Service hours",
};

const reportDescription: Record<ReportKind, string> = {
  attendance:
    "Attendance status and check-in time per member, scoped by event or date range.",
  points:
    "Totals by category (ATTENDANCE, STUDY, SERVICE, MANUAL, FINE) for a window, optionally filtered to one member.",
  roster:
    "Current chapter roster with roles, join dates, and balances. Useful for exec transitions.",
  service:
    "Approved and pending service entries, filtered by member or date range.",
};

type ReportRow = Record<string, unknown>;

function flattenRecord(value: unknown, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  if (value === null || value === undefined) return result;
  if (typeof value !== "object") {
    result[prefix || "value"] = String(value);
    return result;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      Object.assign(result, flattenRecord(child, next));
    } else if (Array.isArray(child)) {
      result[next] = JSON.stringify(child);
    } else {
      result[next] = child === null || child === undefined ? "" : String(child);
    }
  }
  return result;
}

function quoteCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Derive a CSV from any report payload shape.
 *
 * Each API handler returns either `{ rows: [...] }`, `{ entries: [...] }`, or
 * a bare array. We normalize to rows, flatten the first row's keys to compute
 * a stable column order, and emit a UTF-8 CSV with BOM so Excel renders
 * umlauts and emoji correctly on export. The BOM + CRLF output keeps
 * downstream spreadsheet behavior predictable without extra client libs.
 */
function buildCsv(payload: unknown): string {
  const rows = extractRows(payload);
  if (rows.length === 0) return "";
  const flatRows = rows.map((row) => flattenRecord(row));
  const headerSet = new Set<string>();
  for (const flat of flatRows) {
    for (const key of Object.keys(flat)) headerSet.add(key);
  }
  const headers = Array.from(headerSet);
  const lines = [headers.map(quoteCell).join(",")];
  for (const flat of flatRows) {
    lines.push(
      headers.map((header) => quoteCell(flat[header] ?? "")).join(","),
    );
  }
  // BOM + CRLF for Excel friendliness.
  return `\uFEFF${lines.join("\r\n")}`;
}

function extractRows(payload: unknown): ReportRow[] {
  if (Array.isArray(payload)) return payload as ReportRow[];
  if (payload && typeof payload === "object") {
    const bag = payload as Record<string, unknown>;
    for (const key of ["rows", "entries", "members", "items", "data"]) {
      const candidate = bag[key];
      if (Array.isArray(candidate)) return candidate as ReportRow[];
    }
  }
  return [];
}

/**
 * One sentence naming what the API said was cut.
 *
 * Prefers the server's note over the row cap: a roster truncated by its
 * transaction read is the right length with wrong balances, so quoting a row
 * limit it never reached reads as a false alarm and teaches officers to ignore
 * the warning.
 */
function truncationSummary(truncation: ReportTruncation): string {
  if (truncation.note) {
    return `${truncation.note[0]?.toUpperCase()}${truncation.note.slice(1)}.`;
  }
  return truncation.rowLimit
    ? `Capped at ${truncation.rowLimit.toLocaleString()} rows.`
    : "The API reported this report as incomplete.";
}

function downloadCsv(kind: ReportKind, csv: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `frapp-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { toast } = useToast();
  // All four report routes are POSTs on `ReportController`, which carries no
  // `@FreeTier`, so generating one is a paid-op even though it reads like a
  // read (#841). Both buttons that reach `invokeReport` mirror the gate; the
  // filters and the local CSV serialization below do not (§5: never gate a
  // read). The server guard is still the enforcement.
  const gate = useSubscriptionGate();
  const attendance = useAttendanceReport();
  const points = usePointsReport();
  const roster = useRosterReport();
  const service = useServiceReport();

  const [kind, setKind] = useState<ReportKind>("attendance");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [memberId, setMemberId] = useState("");
  const [eventId, setEventId] = useState("");
  const [pointsWindow, setPointsWindow] = useState<
    "all" | "semester" | "month"
  >("all");
  const [preview, setPreview] = useState<ReportRow[] | null>(null);
  /** Truncation reported alongside the current preview, if any. */
  const [truncation, setTruncation] = useState<ReportTruncation | null>(null);

  /**
   * Any filter edit invalidates the preview.
   *
   * "Download CSV" serializes `preview`, while "Download PDF" re-queries with
   * whatever the filters currently say. Without this, editing a date after
   * generating leaves the two buttons exporting different data from the same
   * screen — and the CSV silently carries rows that no longer match the filters
   * the user is looking at. The kind Select already cleared it; the filter
   * inputs did not.
   */
  function onFilterChange<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPreview(null);
      setTruncation(null);
    };
  }
  // Tracked separately from the mutation's own isPending: the PDF export reuses
  // the same mutation, so without this the preview panel would flip to its
  // loading state during a download that never touches the preview.
  const [pdfPending, setPdfPending] = useState(false);

  /** Union of flattened keys for preview rows, stable column order (matches CSV union logic). */
  const previewColumnKeys = useMemo(() => {
    if (!preview || preview.length === 0) return [];
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const row of preview.slice(0, 25)) {
      for (const key of Object.keys(flattenRecord(row))) {
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
    return keys;
  }, [preview]);

  const activeMutation = useMemo(() => {
    switch (kind) {
      case "attendance":
        return attendance;
      case "points":
        return points;
      case "roster":
        return roster;
      case "service":
        return service;
    }
  }, [attendance, kind, points, roster, service]);

  /** Run the selected report at a given format, with the current filters. */
  async function invokeReport(
    format: ReportFormat,
  ): Promise<ReportResponse<unknown>> {
    if (kind === "attendance") {
      return attendance.mutateAsync({
        format,
        body: {
          event_id: eventId || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        },
      });
    }
    if (kind === "points") {
      return points.mutateAsync({
        format,
        body: {
          user_id: memberId || undefined,
          window: pointsWindow,
        },
      });
    }
    if (kind === "roster") {
      return roster.mutateAsync({ format });
    }
    return service.mutateAsync({
      format,
      body: {
        user_id: memberId || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
    });
  }

  async function runReport() {
    try {
      const { payload, truncation } = await invokeReport("json");

      const rows = extractRows(payload);
      setPreview(rows);
      setTruncation(truncation);

      if (rows.length === 0) {
        toast({
          title: "Report is empty",
          description:
            "Adjust the filters (date range, member) and retry. Empty windows produce no rows.",
        });
        return;
      }

      // A truncated report must not read as a finished one here: this toast is
      // what an officer sees immediately before clicking "Download CSV" and
      // sending the file on.
      if (truncation.truncated) {
        toast({
          title: `${reportLabel[kind]} report is incomplete`,
          variant: "destructive",
          description: `${truncationSummary(truncation)} Anything you download from this preview is not a complete record of the chapter.`,
        });
        return;
      }

      toast({
        title: `${reportLabel[kind]} report ready`,
        description: `${rows.length} row${rows.length === 1 ? "" : "s"} previewed. Download CSV to share.`,
      });
    } catch (error) {
      toast({
        title: `Couldn't generate ${reportLabel[kind].toLowerCase()} report`,
        description:
          error instanceof Error
            ? error.message
            : "The API rejected the request. Confirm reports:export and retry.",
        variant: "destructive",
      });
    }
  }

  function exportCsv() {
    if (!preview || preview.length === 0) return;
    const csv = buildCsv(preview);
    downloadCsv(kind, csv);
    // The CSV is serialized from the preview, so it inherits the preview's
    // truncation. Saying so at download time is the last point before the file
    // leaves the app and stops carrying any context at all.
    if (truncation?.truncated) {
      toast({
        title: "Downloaded an incomplete CSV",
        variant: "destructive",
        description: `${truncationSummary(truncation)} Do not treat this file as a complete record of the chapter.`,
      });
    }
  }

  /**
   * PDF export goes back to the API rather than reusing the preview: the server
   * renders the branded template over the whole query result — not just the 25
   * rows shown here — and stores it privately, handing back a signed URL that
   * expires in an hour.
   *
   * "Whole query result" is bounded by the API's report row ceiling, which the
   * queries now page up to rather than stopping at PostgREST's `max_rows`. A
   * chapter past the ceiling is never silently short: the envelope comes back
   * with `truncated`, and the toast below says so rather than reporting a row
   * count that reads as complete. See spec/behavior/reports.md § Row limits.
   */
  async function exportPdf() {
    setPdfPending(true);
    try {
      const { payload } = await invokeReport("pdf");
      if (!isReportExportEnvelope(payload)) {
        throw new Error("The API did not return a download link.");
      }
      if (typeof window !== "undefined") {
        const anchor = document.createElement("a");
        anchor.href = payload.url;
        anchor.rel = "noopener";
        // The signed URL already carries a download disposition; setting the
        // attribute keeps the filename when the browser honours it locally.
        anchor.download = payload.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      toast({
        title: payload.truncated
          ? `${reportLabel[kind]} PDF ready — incomplete`
          : `${reportLabel[kind]} PDF ready`,
        variant: payload.truncated ? "destructive" : undefined,
        // Prefer the server's note over the row cap. A roster truncated by the
        // transaction read is the right length with wrong balances, so quoting
        // a row limit it never reached reads as a false positive.
        description: payload.truncated
          ? `${
              payload.truncation_note ??
              `Capped at ${payload.row_limit.toLocaleString()} rows`
            }, so this document is not a complete record of the chapter. The download link expires in one hour.`
          : `${payload.row_count} row${
              payload.row_count === 1 ? "" : "s"
            } exported. The download link expires in one hour.`,
      });
    } catch (error) {
      toast({
        title: `Couldn't export ${reportLabel[kind].toLowerCase()} PDF`,
        description:
          error instanceof Error
            ? error.message
            : "The API rejected the request. Confirm reports:export and retry.",
        variant: "destructive",
      });
    } finally {
      setPdfPending(false);
    }
  }

  return (
    <Can
      permission="reports:export"
      fallback={
        <div style={{ minHeight: 160 }}>
          <Card aria-label="Reports & Export permissions check">
            <CardHeader>
              <CardTitle>Reports &amp; Export</CardTitle>
              <CardDescription>
                Checking your chapter permissions…
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
      deniedFallback={
        <div style={{ minHeight: 160 }}>
          <Card>
            <CardHeader>
              <CardTitle>Reports &amp; Export</CardTitle>
              <CardDescription>
                Exporting chapter data requires the <code>reports:export</code>{" "}
                permission. Ask your chapter president to grant access.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">
            Reports &amp; Export
          </h2>
          <p className="text-sm text-muted-foreground">
            Generate attendance, points, roster, and service hours reports.
            Download as CSV, or export a branded PDF with your chapter&apos;s
            name and logo.
          </p>
        </header>

        {/*
          Disable, don't hide (§5 rule 4): the filters and any preview already
          on screen stay usable while the subscription is lapsed — only the two
          buttons that POST are blocked.
        */}
        <SubscriptionNotice gate={gate} feature="generating reports" />

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Choose a report</CardTitle>
            <CardDescription>
              Each report respects the same chapter + permission scoping as the
              rest of the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="report-kind">Report</Label>
                <Select
                  value={kind}
                  // Also locked during a plain "Generate report": the run in
                  // flight resolves into setPreview regardless of what the
                  // select says by then, so switching mid-run would label one
                  // report's rows as another's — and the CSV download names
                  // the file from the *new* kind.
                  disabled={pdfPending || activeMutation.isPending}
                  onValueChange={(value) => {
                    setKind(value as ReportKind);
                    setPreview(null);
                    setTruncation(null);
                  }}
                >
                  <SelectTrigger id="report-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="attendance">
                      {reportLabel.attendance}
                    </SelectItem>
                    <SelectItem value="points">{reportLabel.points}</SelectItem>
                    <SelectItem value="roster">{reportLabel.roster}</SelectItem>
                    <SelectItem value="service">
                      {reportLabel.service}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {reportDescription[kind]}
                </p>
              </div>
            </div>

            {kind === "attendance" ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-1">
                  <Label htmlFor="report-event">Event ID (optional)</Label>
                  <Input
                    id="report-event"
                    value={eventId}
                    onChange={(event) =>
                      onFilterChange(setEventId)(event.target.value)
                    }
                    placeholder="UUID — leave blank for chapter-wide"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="report-start">Start date</Label>
                  <Input
                    id="report-start"
                    type="date"
                    value={startDate}
                    onChange={(event) =>
                      onFilterChange(setStartDate)(event.target.value)
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="report-end">End date</Label>
                  <Input
                    id="report-end"
                    type="date"
                    value={endDate}
                    onChange={(event) =>
                      onFilterChange(setEndDate)(event.target.value)
                    }
                  />
                </div>
              </div>
            ) : null}

            {kind === "points" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="report-member">Member ID (optional)</Label>
                  <Input
                    id="report-member"
                    value={memberId}
                    onChange={(event) =>
                      onFilterChange(setMemberId)(event.target.value)
                    }
                    placeholder="UUID — leave blank for chapter-wide"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="report-window">Time window</Label>
                  <Select
                    value={pointsWindow}
                    onValueChange={(value) =>
                      onFilterChange(setPointsWindow)(
                        value as typeof pointsWindow,
                      )
                    }
                  >
                    <SelectTrigger id="report-window">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="semester">Current semester</SelectItem>
                      <SelectItem value="month">Rolling month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {kind === "service" ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-1">
                  <Label htmlFor="service-report-member">
                    Member ID (optional)
                  </Label>
                  <Input
                    id="service-report-member"
                    value={memberId}
                    onChange={(event) =>
                      onFilterChange(setMemberId)(event.target.value)
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-report-start">Start date</Label>
                  <Input
                    id="service-report-start"
                    type="date"
                    value={startDate}
                    onChange={(event) =>
                      onFilterChange(setStartDate)(event.target.value)
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-report-end">End date</Label>
                  <Input
                    id="service-report-end"
                    type="date"
                    value={endDate}
                    onChange={(event) =>
                      onFilterChange(setEndDate)(event.target.value)
                    }
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              PDF export is generated server-side; its download link is valid
              for one hour.
            </p>
            <div className="flex items-center gap-2">
              {/*
                Not subscription-gated: this serializes the preview already in
                memory and never reaches the API, so it is a read of data the
                chapter has already been served. The rows behind it came from a
                generate that was itself gated.
              */}
              <Button
                variant="outline"
                onClick={exportCsv}
                disabled={!preview || preview.length === 0}
              >
                <Download className="h-4 w-4" />
                Download CSV
              </Button>
              <Button
                variant="outline"
                onClick={exportPdf}
                // Gate on pdfPending too: activeMutation swaps when the report
                // kind changes, so keying only off it would re-enable this
                // button mid-export and let a second render be queued.
                {...gate.controlProps(pdfPending || activeMutation.isPending)}
              >
                {pdfPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                {pdfPending ? "Preparing PDF..." : "Download PDF"}
              </Button>
              <Button
                onClick={runReport}
                {...gate.controlProps(pdfPending || activeMutation.isPending)}
              >
                {activeMutation.isPending && !pdfPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Generate report
              </Button>
            </div>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Preview</CardTitle>
            <CardDescription>
              First 25 rows of the generated report. The CSV download contains
              every returned row.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeMutation.isPending && !pdfPending ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating report...
              </div>
            ) : preview === null ? (
              <p className="text-sm text-muted-foreground">
                Generate a report to see a preview here.
              </p>
            ) : preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Report returned no rows — the filters matched nothing in the
                active chapter.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full divide-y divide-border text-xs">
                  <thead className="bg-secondary/40">
                    <tr>
                      {previewColumnKeys.map((key) => (
                        <th
                          key={key}
                          className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground"
                        >
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 25).map((row, index) => {
                      const flat = flattenRecord(row);
                      return (
                        <tr key={index} className="border-t border-border/70">
                          {previewColumnKeys.map((key) => (
                            <td
                              key={key}
                              className="whitespace-nowrap px-3 py-1.5"
                            >
                              {flat[key] ?? ""}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Can>
  );
}
