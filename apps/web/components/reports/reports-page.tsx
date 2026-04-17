"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import {
  useAttendanceReport,
  usePointsReport,
  useRosterReport,
  useServiceReport,
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

function flattenRecord(
  value: unknown,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (value === null || value === undefined) return result;
  if (typeof value !== "object") {
    result[prefix || "value"] = String(value);
    return result;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child)
    ) {
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
  const attendance = useAttendanceReport();
  const points = usePointsReport();
  const roster = useRosterReport();
  const service = useServiceReport();

  const [kind, setKind] = useState<ReportKind>("attendance");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [memberId, setMemberId] = useState("");
  const [eventId, setEventId] = useState("");
  const [pointsWindow, setPointsWindow] = useState<"all" | "semester" | "month">(
    "all",
  );
  const [preview, setPreview] = useState<ReportRow[] | null>(null);

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

  async function runReport() {
    try {
      let payload: unknown = null;
      if (kind === "attendance") {
        payload = await attendance.mutateAsync({
          body: {
            event_id: eventId || undefined,
            start_date: startDate || undefined,
            end_date: endDate || undefined,
          },
        });
      } else if (kind === "points") {
        payload = await points.mutateAsync({
          body: {
            user_id: memberId || undefined,
            window: pointsWindow,
          },
        });
      } else if (kind === "roster") {
        payload = await roster.mutateAsync({});
      } else if (kind === "service") {
        payload = await service.mutateAsync({
          body: {
            user_id: memberId || undefined,
            start_date: startDate || undefined,
            end_date: endDate || undefined,
          },
        });
      }

      const rows = extractRows(payload);
      setPreview(rows);

      if (rows.length === 0) {
        toast({
          title: "Report is empty",
          description:
            "Adjust the filters (date range, member) and retry. Empty windows produce no rows.",
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
  }

  return (
    <Can
      permission="reports:export"
      deniedFallback={
        <Card>
          <CardHeader>
            <CardTitle>Reports & Export</CardTitle>
            <CardDescription>
              Exporting chapter data requires the <code>reports:export</code>{" "}
              permission. Ask your chapter president to grant access.
            </CardDescription>
          </CardHeader>
        </Card>
      }
    >
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">
            Reports &amp; Export
          </h2>
          <p className="text-sm text-muted-foreground">
            Generate attendance, points, roster, and service hours reports.
            Download as CSV today; branded PDF export is parked behind a
            dedicated backend slice.
          </p>
        </header>

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
                  onValueChange={(value) => {
                    setKind(value as ReportKind);
                    setPreview(null);
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
                    <SelectItem value="service">{reportLabel.service}</SelectItem>
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
                    onChange={(event) => setEventId(event.target.value)}
                    placeholder="UUID — leave blank for chapter-wide"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="report-start">Start date</Label>
                  <Input
                    id="report-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="report-end">End date</Label>
                  <Input
                    id="report-end"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
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
                    onChange={(event) => setMemberId(event.target.value)}
                    placeholder="UUID — leave blank for chapter-wide"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="report-window">Time window</Label>
                  <Select
                    value={pointsWindow}
                    onValueChange={(value) =>
                      setPointsWindow(value as typeof pointsWindow)
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
                    onChange={(event) => setMemberId(event.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-report-start">Start date</Label>
                  <Input
                    id="service-report-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="service-report-end">End date</Label>
                  <Input
                    id="service-report-end"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              PDF export is coming in a later slice. Use CSV for now.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={exportCsv}
                disabled={!preview || preview.length === 0}
              >
                <Download className="h-4 w-4" />
                Download CSV
              </Button>
              <Button onClick={runReport} disabled={activeMutation.isPending}>
                {activeMutation.isPending ? (
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
            {activeMutation.isPending ? (
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
                  <thead className="bg-muted/40">
                    <tr>
                      {Array.from(
                        new Set(
                          preview
                            .slice(0, 25)
                            .flatMap((row) =>
                              Object.keys(flattenRecord(row)),
                            ),
                        ),
                      ).map((key) => (
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
                      const keys = Object.keys(flat);
                      return (
                        <tr key={index} className="border-t border-border/70">
                          {keys.map((key) => (
                            <td
                              key={key}
                              className="whitespace-nowrap px-3 py-1.5"
                            >
                              {flat[key]}
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
