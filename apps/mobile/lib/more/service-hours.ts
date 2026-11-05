/**
 * Narrowing and derivation for the service-hours screen and its s20 log sheet,
 * over `GET /v1/service-entries`.
 *
 * The endpoint pins a non-admin's read to their own id server-side, so what
 * comes back here is already the member's own history — no client-side filter
 * makes that true, and none should pretend to.
 */
import {
  formatMinutesRounded,
  localIsoDate,
  parseBareDateLocalNoon,
} from "@repo/formatting";
import type { ServiceEntryStatus } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { metaLine, num, records, str } from "./narrow";
import { formatHours } from "./profile";
import { addDays } from "@/lib/tasks/create-task";

export interface ServiceEntryRow {
  id: string;
  description: string;
  status: ServiceEntryStatus;
  durationMinutes: number;
  /** e.g. `"2h 30m · Aug 12"`. */
  meta: string | null;
  date: string;
}

export interface ServiceSummary {
  approvedMinutes: number;
  /** Approved hours, one decimal — the number the summary card leads with. */
  approvedHours: string;
  pendingCount: number;
}

const STATUSES: ReadonlySet<string> = new Set<ServiceEntryStatus>([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

/**
 * A status chip's hue, web's `serviceStatusKind`: a status color, never the
 * chapter accent (`spec/ui/design-system/components.md` §5). Pending is not
 * yet settled, so it is the warning. Exhaustive, so a status added to
 * `@repo/hooks` fails to compile here rather than painting as one of these.
 */
export function serviceStatusHue(
  status: ServiceEntryStatus,
  tokens: SignetTokens,
): string {
  switch (status) {
    case "APPROVED":
      return tokens.color.semantic.success;
    case "REJECTED":
      return tokens.color.semantic.destructive;
    case "PENDING":
      return tokens.color.semantic.warning;
    default: {
      const unknownStatus: never = status;
      return unknownStatus;
    }
  }
}

/** A single logged shift longer than a day is a typo, not a shift. */
export const MAX_DURATION_MINUTES = 24 * 60;

/** `"2026-08-12"` → `"Aug 12"`. Falls back to the raw value if unparseable. */
function formatDate(value: string): string {
  // Parsed at local noon: `new Date` reads a bare `YYYY-MM-DD` as UTC midnight,
  // which renders as the previous day for anyone west of Greenwich, and UTC
  // noon is already the next day at UTC+12 and east (#3026). A service entry
  // dated the 12th must read the 12th everywhere. Protected cluster — do not
  // fold into formatLocaleDate.
  const date = parseBareDateLocalNoon(value);
  if (!date) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function toRow(row: Record<string, unknown>): ServiceEntryRow | null {
  const id = str(row, "id");
  const rawStatus = str(row, "status");
  const date = str(row, "date");
  if (!id || !rawStatus || !STATUSES.has(rawStatus) || !date) return null;

  const durationMinutes = num(row, "duration_minutes") ?? 0;
  return {
    id,
    description: str(row, "description") ?? "Service entry",
    status: rawStatus as ServiceEntryStatus,
    durationMinutes,
    meta: metaLine([formatMinutesRounded(durationMinutes), formatDate(date)]),
    date,
  };
}

/** The member's entries, newest first. */
export function selectServiceEntryRows(data: unknown): ServiceEntryRow[] {
  return records(data)
    .map(toRow)
    .filter((row): row is ServiceEntryRow => !!row)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The summary card's numbers.
 *
 * Approved only, matching how the chapter leaderboard counts: pending time is
 * not yet credited, so banking it here would overstate what the member has.
 * Pending is surfaced as a count instead, which is what they can act on.
 */
export function summarizeServiceEntries(rows: ServiceEntryRow[]): ServiceSummary {
  const approvedMinutes = rows
    .filter((row) => row.status === "APPROVED")
    .reduce((total, row) => total + row.durationMinutes, 0);

  return {
    approvedMinutes,
    approvedHours: formatHours(approvedMinutes),
    pendingCount: rows.filter((row) => row.status === "PENDING").length,
  };
}

/** The stepper's increment, and its floor: the board steps in half hours. */
export const DURATION_STEP_MINUTES = 30;

/** Where the s20 stepper starts: one hour. */
export const DEFAULT_DURATION_MINUTES = 60;

/**
 * One tap of the s20 duration stepper, clamped to half an hour and a day.
 *
 * The stepper replaced a free-text duration field. That field took "2:30" or
 * "2.5", which on Android meant hunting for the colon on the symbols layer
 * (`numbers-and-punctuation` is an iOS keyboard), and it read a bare "45" as 45
 * hours. A stepper needs no keyboard and has no ambiguous input. It costs
 * quarter-hour precision, which an officer reviewing a shift doesn't need.
 */
export function stepDuration(minutes: number, direction: 1 | -1): number {
  const next = minutes + direction * DURATION_STEP_MINUTES;
  return Math.min(MAX_DURATION_MINUTES, Math.max(DURATION_STEP_MINUTES, next));
}

export interface ServiceDatePreset {
  /** Days before today, which is also the chip's value in the row. */
  daysAgo: number;
  label: string;
  /** `YYYY-MM-DD`, device-local: the `date` the entry is filed under. */
  date: string;
  /**
   * How an entry kept past the day it was picked reads this chip. "Today" and
   * "Yesterday" are relative: they mean the day the entry is filed and the
   * day before. A weekday chip names a date, and the entry keeps that date
   * ({@link resolveServiceDate}).
   */
  relative: boolean;
}

/** How many days the date chips reach, today included. */
const DATE_PRESET_COUNT = 4;

/** The chips named for their distance from today: Today and Yesterday. */
const RELATIVE_PRESET_COUNT = 2;

/**
 * The s20 date chips: Today, Yesterday, then the two days before by weekday
 * ("Tue", "Mon"), so a Saturday shift can still be logged on Monday.
 *
 * Backwards only, the mirror of s19's due presets, because a shift is logged
 * after it happens. Short weekday names keep all four chips on one row at
 * phone width, where "Wednesday" would wrap it. Counted in calendar days by
 * s19's `addDays`, so a daylight-saving change can't skip or repeat a day.
 */
export function serviceDatePresets(now: Date): ServiceDatePreset[] {
  return Array.from({ length: DATE_PRESET_COUNT }, (_, daysAgo) => {
    const day = addDays(now, -daysAgo);
    const label =
      daysAgo === 0
        ? "Today"
        : daysAgo === 1
          ? "Yesterday"
          : day.toLocaleDateString(undefined, { weekday: "short" });
    return {
      daysAgo,
      label,
      date: localIsoDate(day),
      relative: daysAgo < RELATIVE_PRESET_COUNT,
    };
  });
}

/**
 * A date chip as an entry holds it: a relative chip by how many days back it
 * is, re-read against the day the entry is filed, or the date a weekday chip
 * named when it was picked (see {@link ServiceDatePreset.relative}).
 */
export type ServiceDateChoice =
  | { kind: "relative"; daysAgo: number }
  | { kind: "date"; date: string };

/** A new entry's date choice: "Today". */
export const DEFAULT_SERVICE_DATE_CHOICE: ServiceDateChoice = {
  kind: "relative",
  daysAgo: 0,
};

/** What an entry holds once the member picks `preset`. */
export function serviceDateChoiceOf(
  preset: ServiceDatePreset,
): ServiceDateChoice {
  return preset.relative
    ? { kind: "relative", daysAgo: preset.daysAgo }
    : { kind: "date", date: preset.date };
}

export interface ResolvedServiceDate {
  /** `YYYY-MM-DD`, device-local: the date Submit files. */
  date: string;
  /** The chip `now`'s presets draw for `date`, which the row shows selected. */
  daysAgo: number;
}

/**
 * A held date choice, read on the day `now` falls on.
 *
 * A relative chip is that chip's date today. A held date stays as picked, and
 * the chip shown selected is whichever of today's resolves to it: a "Mon"
 * picked on a Wednesday is still Monday on the Thursday, now the oldest chip.
 * A held date that has left the chip window falls back to Today. s19 can keep
 * a date no chip draws, because its date field shows the date it files; s20
 * draws its date only as the selected chip, so a date no chip names would file
 * a day nothing on screen shows.
 */
export function resolveServiceDate(
  choice: ServiceDateChoice,
  now: Date,
): ResolvedServiceDate {
  const presets = serviceDatePresets(now);
  const held =
    choice.kind === "relative"
      ? presets.find((preset) => preset.daysAgo === choice.daysAgo)?.date
      : choice.date;
  const chip = presets.find((preset) => preset.date === held);
  if (chip) return { date: chip.date, daysAgo: chip.daysAgo };
  return { date: localIsoDate(now), daysAgo: 0 };
}
