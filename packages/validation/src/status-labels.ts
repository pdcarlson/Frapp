/**
 * The member-facing word for every status the API stores, on web and mobile
 * alike (principles.md P2.1, writing.md §5).
 *
 * A status is a word, not the database's token: `APPROVED` reads "Approved",
 * `IN_PROGRESS` reads "In progress". Each vocabulary is listed once here so the
 * two apps can't drift ("Done" on one, "Completed" on the other), and a
 * surface that needs its own phrasing (the chat hours card's "Pending review")
 * builds it from these rather than restating the rest.
 *
 * The badge colour for a status is not here: that is each app's design
 * system's call (`apps/web/components/*\/…-status.ts`).
 */
export const STATUS_LABELS = {
  /** `tasks.status`, plus the derived `OVERDUE`. */
  task: {
    TODO: "To do",
    IN_PROGRESS: "In progress",
    COMPLETED: "Awaiting confirmation",
    OVERDUE: "Overdue",
  },
  /** `service_entries.status`. */
  serviceEntry: {
    PENDING: "Pending",
    APPROVED: "Approved",
    REJECTED: "Rejected",
  },
  /** `event_attendance.status`, plus `UNRECORDED` for a member with no row. */
  attendance: {
    PRESENT: "Present",
    LATE: "Late",
    EXCUSED: "Excused",
    ABSENT: "Absent",
    UNRECORDED: "Unrecorded",
  },
  /** `study_sessions.status`. */
  studySession: {
    ACTIVE: "Active",
    COMPLETED: "Completed",
    EXPIRED: "Expired",
    PAUSED_EXPIRED: "Expired while paused",
    LOCATION_INVALID: "Outside zone",
  },
  /** `invoices.status`, plus the derived `OVERDUE`. */
  invoice: {
    DRAFT: "Draft",
    OPEN: "Open",
    PAID: "Paid",
    VOID: "Void",
    OVERDUE: "Overdue",
  },
} as const satisfies Record<string, Record<string, string>>;

export type StatusVocabulary = keyof typeof STATUS_LABELS;

/**
 * The word for `token` in `vocabulary`. A token this map doesn't know yet (a
 * status the API added after this build shipped) reads as plain words,
 * `NEW_STATE` as "New state", never as the token.
 */
export function statusLabel(
  vocabulary: StatusVocabulary,
  token: string,
): string {
  const labels: Readonly<Record<string, string>> = STATUS_LABELS[vocabulary];
  return labels[token] ?? wordsFromToken(token);
}

function wordsFromToken(token: string): string {
  const words = token.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
