/**
 * Asking for minutes that haven't been posted (#5471, `spec/behavior/meetings.md`
 * § Asking for minutes): the event's Minutes row, on web and phone.
 */
export const MINUTES_REQUEST_COPY = {
  /** The row's status while the minutes are an unposted draft. */
  notPosted: "Not posted yet",
  /** The same, once the reader has asked. */
  requestedStatus: "Not posted yet. You asked for them.",
  request: "Request minutes",
  requested: "Requested",
  /** Named for a screen reader after asking. */
  requestedLabel: "Minutes requested",
  sentTitle: "Minutes requested",
  sentBody: "Whoever is writing them gets a reminder.",
  failed: "Couldn't request the minutes",
} as const;
