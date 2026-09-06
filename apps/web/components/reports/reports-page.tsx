"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  isReportExportEnvelope,
  useAttendanceReport,
  useEvents,
  useMembers,
  useMyPermissions,
  usePointsReport,
  useRosterReport,
  useServiceReport,
  type ReportFormat,
  type ReportResponse,
  type ReportTruncation,
} from "@repo/hooks";
import { formatLocaleDateTime } from "@repo/formatting";
import { can } from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
} from "@/components/shared/nested-states";
import { PermissionsOfflineSurface } from "@/components/shared/async-states";
import {
  DocumentsGlyph,
  ReportsGlyph,
} from "@/components/documents/resources-glyphs";
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
import { dashboardFormSelectClassName } from "@/components/shared/table-controls";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { asArray, downloadCsv } from "@/lib/utils";

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

type PickerOption = { id: string; label: string };

function asRecords(data: unknown): Record<string, unknown>[] {
  return asArray<unknown>(data).filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null,
  );
}

/** Options for the event picker: name plus start time, so two same-named events stay distinguishable. */
function buildEventOptions(data: unknown): PickerOption[] {
  return asRecords(data)
    .map((event) => {
      const id = String(event.id ?? "");
      if (!id) return null;
      const name = String(event.name ?? "Untitled event");
      return { id, label: `${name} — ${formatLocaleDateTime(event.start_time)}` };
    })
    .filter((option): option is PickerOption => option !== null);
}

/**
 * Options for the member picker: display name plus email, falling back to a
 * short id when both are missing.
 *
 * Uses the full `useMembers()` profile rather than the lighter
 * `useChapterRoster()` (which is the documented default for a display-only
 * concern like this): the roster projection carries no `email`, and email is
 * what the AC asks for to disambiguate same-named members.
 */
function buildMemberOptions(data: unknown): PickerOption[] {
  return asRecords(data)
    .map((member) => {
      const id = String(member.user_id ?? "");
      if (!id) return null;
      const displayName =
        typeof member.display_name === "string" ? member.display_name : "";
      const email = typeof member.email === "string" ? member.email : "";
      const label = displayName
        ? email
          ? `${displayName} (${email})`
          : displayName
        : email || `Member ${id.slice(0, 8)}`;
      return { id, label };
    })
    .filter((option): option is PickerOption => option !== null);
}

type PickerFieldQuery = {
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

type PickerFieldProps = {
  idPrefix: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: PickerOption[];
  query: PickerFieldQuery;
  /** e.g. "Chapter-wide (all events)" */
  allLabel: string;
  /** Plural noun used in the empty/error copy, e.g. "events". */
  noun: string;
  /** Singular noun used in the manual-entry disclosure, e.g. "event". */
  singularNoun: string;
};

/**
 * A named-entity filter: a picker `<select>` backed by a live list, plus a
 * collapsed manual-ID fallback.
 *
 * The fallback exists because the picker can only offer what its list query
 * returns, and that query is scoped by `members:view` (and, for events, the
 * `events` module) — permissions `reports:export` does not imply. A caller
 * who knows an id the list omits (a departed member, a role-targeted event,
 * or a custom role without `members:view`) can still reach it directly,
 * matching what the raw-UUID input this replaces already allowed.
 */
function PickerField({
  idPrefix,
  label,
  value,
  onValueChange,
  options,
  query,
  allLabel,
  noun,
  singularNoun,
}: PickerFieldProps) {
  const matchesOption = options.some((option) => option.id === value);
  const selectId = `${idPrefix}-select`;

  return (
    <div className="grid gap-1">
      <Label htmlFor={selectId}>{label}</Label>
      <select
        id={selectId}
        // Falls back to the "chapter-wide" option rather than letting the
        // browser show nothing selected whenever `value` is a manually-entered
        // id the list doesn't contain — the manual field below is the one
        // source of truth for that case.
        value={matchesOption ? value : ""}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={query.isPending}
        className={`${dashboardFormSelectClassName} w-full`}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {query.isError ? (
        <p className="text-xs text-destructive">
          Couldn&apos;t load {noun} — enter an id manually below, or leave
          both blank for a chapter-wide report, or{" "}
          <button
            type="button"
            onClick={() => query.refetch()}
            className="underline underline-offset-2"
          >
            retry
          </button>
          .
        </p>
      ) : !query.isPending && options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No {noun} yet — every report will be chapter-wide.
        </p>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">
          Can&apos;t find the {singularNoun}? Enter its id directly
        </summary>
        <Input
          className="mt-1"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={`${singularNoun} id`}
        />
        {value && !matchesOption ? (
          <p className="mt-1">
            Not in the list above — the report will still scope to this id.
          </p>
        ) : null}
      </details>
    </div>
  );
}

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

/**
 * Flatten any report payload shape into rows ready for `downloadCsv`.
 *
 * Each API handler returns either `{ rows: [...] }`, `{ entries: [...] }`, or
 * a bare array. We normalize to rows and flatten each row's keys — column
 * order, escaping, and BOM/CRLF are the shared `downloadCsv`'s job.
 */
function buildRows(payload: unknown): Record<string, string>[] {
  return extractRows(payload).map((row) => flattenRecord(row));
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
  // Mirrors the `<Can permission="reports:export">` gate this page renders
  // behind (same cached query, so this costs no extra request): without it,
  // `useEvents`/`useMembers` would fetch every member's full profile —
  // email, bio, graduation year, city, company — for a visitor who cannot
  // even see this page, purely as a side effect of pickers they'll never see.
  const permissionsQuery = useMyPermissions();
  const canFilterByEventOrMember = can(
    "reports:export",
    permissionsQuery.data?.permissions ?? [],
  );
  const eventsQuery = useEvents({ enabled: canFilterByEventOrMember });
  const membersQuery = useMembers({ enabled: canFilterByEventOrMember });
  const eventOptions = useMemo(
    () => buildEventOptions(eventsQuery.data),
    [eventsQuery.data],
  );
  const memberOptions = useMemo(
    () => buildMemberOptions(membersQuery.data),
    [membersQuery.data],
  );

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
  /*
    A failed run used to be a toast and nothing else: `setPreview` was
    never reached, so `preview` stayed `null` and the panel fell through to
    "Generate a report to see a preview here." — a failure rendering as the
    initial state, with no retry. README §4 requires an error state with a
    retry path on every async view, and `writing.md` §7's Reports table had
    no Error row for it, which is why nothing caught it.
  */
  const [previewError, setPreviewError] = useState<string | null>(null);
  /*
    Which run the preview belongs to.

    `onFilterChange` clears the preview the moment a filter is edited, but it
    cannot cancel a request already in flight — so a generate started under the
    old filters would resolve afterwards and call `setPreview` with rows that no
    longer match what the form says. The member sees a table scoped to nobody
    beside a Member ID field naming somebody, and "Download CSV" — which gates
    only on `preview` being non-empty — exports those rows under that
    appearance. Each run takes a token and only the newest one is allowed to
    write.
  */
  const runToken = useRef(0);

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
      runToken.current += 1;
      setPreview(null);
      setTruncation(null);
      setPreviewError(null);
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
    runToken.current += 1;
    const token = runToken.current;
    // The previous run's verdict is not this run's. Without this the header
    // keeps its "Incomplete report" badge for the whole time a fresh request
    // is in flight, describing a result nobody has seen yet.
    setTruncation(null);
    setPreviewError(null);
    try {
      const { payload, truncation } = await invokeReport("json");
      if (token !== runToken.current) return;

      const rows = extractRows(payload);
      setPreview(rows);
      setTruncation(truncation);
      setPreviewError(null);

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
      if (token !== runToken.current) return;
      const description =
        error instanceof Error
          ? error.message
          : "The API rejected the request. Confirm reports:export and retry.";
      // Both, deliberately: the toast reports the moment, and the panel keeps
      // saying so after the toast dismisses. A failed run that leaves the idle
      // copy on screen is a failure reported as "nothing has happened yet".
      setPreview(null);
      setTruncation(null);
      setPreviewError(description);
      toast({
        title: `Couldn't generate ${reportLabel[kind].toLowerCase()} report`,
        description,
        variant: "destructive",
      });
    }
  }

  function exportCsv() {
    if (!preview || preview.length === 0) return;
    downloadCsv(buildRows(preview), kind);
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
      offlineFallback={(retry) => (
        <PermissionsOfflineSurface
          description="Reconnect to check whether you can export chapter data."
          onRetry={retry}
        />
      )}
      fallback={
        <div className="min-h-40">
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
        <div className="min-h-40">
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
                    runToken.current += 1;
                    setPreview(null);
                    setTruncation(null);
                    setPreviewError(null);
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
                <PickerField
                  idPrefix="report-event"
                  label="Event (optional)"
                  value={eventId}
                  onValueChange={onFilterChange(setEventId)}
                  options={eventOptions}
                  query={eventsQuery}
                  allLabel="Chapter-wide (all events)"
                  noun="events"
                  singularNoun="event"
                />
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
                <PickerField
                  idPrefix="report-member"
                  label="Member (optional)"
                  value={memberId}
                  onValueChange={onFilterChange(setMemberId)}
                  options={memberOptions}
                  query={membersQuery}
                  allLabel="Chapter-wide (all members)"
                  noun="members"
                  singularNoun="member"
                />
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
                <PickerField
                  idPrefix="service-report-member"
                  label="Member (optional)"
                  value={memberId}
                  onValueChange={onFilterChange(setMemberId)}
                  options={memberOptions}
                  query={membersQuery}
                  allLabel="Chapter-wide (all members)"
                  noun="members"
                  singularNoun="member"
                />
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
                variant="secondary"
                onClick={exportCsv}
                disabled={!preview || preview.length === 0}
              >
                <Download className="h-4 w-4" />
                Download CSV
              </Button>
              <Button
                variant="secondary"
                onClick={exportPdf}
                // Gate on pdfPending too: activeMutation swaps when the report
                // kind changes, so keying only off it would re-enable this
                // button mid-export and let a second render be queued.
                {...gate.controlProps(pdfPending || activeMutation.isPending)}
              >
                {pdfPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <DocumentsGlyph className="h-4 w-4" />
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
                  <ReportsGlyph className="h-4 w-4" />
                )}
                Generate report
              </Button>
            </div>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg">Preview</CardTitle>
              {/*
                `spec/behavior/reports.md` caps a report at 5,000 rows and
                says truncation is never silent — but the only signal was a
                toast, so once it dismissed a partial table sat on screen
                claiming to be the whole report, and the CSV built from it
                carries the same claim into a file. §5's Semantic warning
                kind, which needs no §1 lift on its own tint (5.57–7.15:1).
              */}
              {truncation?.truncated ? (
                <Badge variant="warning">Incomplete report</Badge>
              ) : null}
            </div>
            <CardDescription>
              {truncation?.truncated
                ? `${truncationSummary(truncation)} This preview and the CSV built from it are not a complete record of the chapter.`
                : "First 25 rows of the generated report. The CSV download contains every returned row."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/*
              The nested state variants: this renders inside a
              `<CardContent>`, where a `bg-card` state on a `bg-card` card is
              exactly 1.00:1 and the region disappears (`components.md` §10).
              This panel previously rendered no state-family component at all —
              bare paragraphs and a hand-rolled spinner row — so it was the one
              surface in the family whose states did not match the other three.
            */}
            {activeMutation.isPending && !pdfPending ? (
              <NestedLoading message="Generating report..." sole />
            ) : previewError ? (
              <NestedError
                sole
                title={`Couldn't generate ${reportLabel[kind].toLowerCase()} report`}
                description={previewError}
                onRetry={() => void runReport()}
                /*
                  `gate.controlProps`, not a hand-built `{ disabled }`. Retry
                  re-enters `runReport` — the same paid-ops POST the two footer
                  buttons carry the gate on — so it is a third trigger for a
                  gated write and README §5's "gate the trigger" reaches it
                  too. Building the object by hand disabled it only while busy,
                  so a chapter that lapsed between the failed run and the click
                  would have fired the doomed request the standard exists to
                  prevent. The busy flags go *into* `controlProps`, which ORs
                  them with the verdict rather than replacing it — and this is
                  the shape `actionProps`/`retryProps` were built to take.

                  The busy half matters on its own: the loading branch above is
                  `activeMutation.isPending && !pdfPending`, so during a PDF
                  export it is false and this branch renders its stale error
                  with Retry wired to the same mutation the export is using.
                */
                retryProps={gate.controlProps(
                  pdfPending || activeMutation.isPending,
                )}
              />
            ) : preview === null ? (
              <NestedEmpty
                sole
                title="No report generated yet"
                description="Generate a report to see a preview here."
              />
            ) : preview.length === 0 ? (
              <NestedEmpty
                sole
                title="Report returned no rows"
                description="The filters matched nothing in the active chapter."
              />
            ) : (
              /*
                The shared primitive rather than a hand-rolled `<table>`. It
                brings the `overflow-auto` wrapper that keeps a wide report off
                the 375px floor, the undiluted `--border` hairline, and the row
                recipe `components/shared/table-contrast.spec.ts` already pins.
                The hand-rolled one carried three defects at once: a
                `bg-secondary/40` header that is 1.000:1 on a card, a
                `border-border/70` row rule at the diluted alpha §2 forbids,
                and `text-xs` cells under foundations §7's 16px body floor.
              */
              <Table>
                <TableHeader>
                  <TableRow>
                    {previewColumnKeys.map((key) => (
                      <TableHead key={key} className="whitespace-nowrap">
                        {key}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 25).map((row, index) => {
                    const flat = flattenRecord(row);
                    return (
                      <TableRow key={index}>
                        {previewColumnKeys.map((key) => (
                          <TableCell key={key} className="whitespace-nowrap">
                            {flat[key] ?? ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Can>
  );
}
