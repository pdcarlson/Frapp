import {
  MEETING_SECTIONS,
  meetingTypeLabel,
  type MeetingSectionKey,
  type MeetingType,
  type MeetingVote,
} from "@repo/validation";

/**
 * Words the minutes screens share. Dates are written out in full (Paul,
 * 2026-11-07: never "Tue" or "Nov 11"), with the year only when it isn't
 * this one.
 */
export function meetingDayLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** A due day stored as `YYYY-MM-DD`, read in the reader's own calendar. */
export function meetingDueLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return meetingDayLabel(new Date(year, month - 1, day, 12).toISOString(), now);
}

export function meetingTitleLine(meeting: {
  meeting_type: string;
  other_label?: string | null;
  event_start_time: string;
}): string {
  const type = meetingTypeLabel(
    meeting.meeting_type as MeetingType,
    meeting.other_label,
  );
  return `${type} · ${meetingDayLabel(meeting.event_start_time)}`;
}

export function sectionLabel(key: MeetingSectionKey): string {
  return MEETING_SECTIONS.find((section) => section.key === key)?.label ?? key;
}

/** "30 for, 2 against, 1 abstaining", only the counts the meeting recorded. */
export function voteLine(vote: MeetingVote | null): string {
  if (!vote) return "";
  return `${vote.for} for, ${vote.against} against, ${vote.abstain} abstaining`;
}

/**
 * The type an event's name suggests, so "Exec meeting" opens on Exec. Only a
 * starting point; the officer picks.
 */
export function guessMeetingType(eventName: string): MeetingType {
  const name = eventName.toLowerCase();
  if (/\bexec|executive|e-board|eboard|officer/.test(name)) return "exec";
  if (/committee|\bchair/.test(name)) return "committee";
  return "chapter";
}

/** The minutes' own page. */
export function meetingHref(id: string): string {
  return `/meetings/${id}`;
}
