import type { BadgeKind } from "@/components/ui/badge";

/** The four states the server stores, plus the client-only "no row yet". */
export type AttendanceStatus = "PRESENT" | "EXCUSED" | "ABSENT" | "LATE";
export type AttendanceStatusOrUnrecorded = AttendanceStatus | "UNRECORDED";

/**
 * Attendance state → the §5 badge kind that states it.
 *
 * `attendance-panel.tsx` had a `statusVariant()` switch mapping `PRESENT` to
 * `default` — the **chapter accent** — which `writing.md` §5 rules out directly:
 * "status labels render with the semantic status colors … status color is never
 * decorative". #1202.
 *
 * That is a measurement rather than a preference, and the Directory & Finance
 * slice of #920 already recorded it for the same defect one family over: across
 * the seeded chapter directory an accent badge sits 1.08:1 from the success
 * tint under a green-accented chapter and 1.13:1 from the danger tint under a
 * red-accented one. So the chapter whose brand most needs `PRESENT` to read as
 * present is exactly the chapter where it renders as absent — and `ABSENT` is
 * the badge sitting next to it in the same column. The measurement is pinned
 * across all 19 seeds in `../billing/status-contrast.test.ts`; that this mapper
 * never returns the accent is pinned in `../shared/status-kind.test.ts`.
 *
 * `LATE` moves off `secondary` in the same change. `secondary` is §5's
 * **Neutral** kind — "counts and unread markers" — so a status was being
 * painted in the count badge. Late is foundations §5's "at-risk": present, but
 * not as required.
 *
 * `EXCUSED` and `UNRECORDED` take §5's Hairline kind for the same reason
 * `invoice-status.ts` gives `DRAFT`: they are the *absence* of an attendance
 * fact rather than one. Excused is a member who owed no attendance, and
 * unrecorded is a row the roster synthesised because no attendance exists yet —
 * neither is a success, a warning or a failure, and §5 reserves Hairline for
 * "quiet metadata that must not read as a status".
 *
 * Neither `success` nor `warning` takes §1's lift: measured on their own 13%
 * tints they are 5.02–6.46:1 and 5.57–7.15:1, both clear of the gate
 * (`components.md` §5). Only danger has a lifted twin, and `Badge` applies it.
 */
export function attendanceStatusKind(
  status: AttendanceStatusOrUnrecorded,
): BadgeKind {
  switch (status) {
    case "PRESENT":
      return "success";
    case "LATE":
      return "warning";
    case "ABSENT":
      return "destructive";
    case "EXCUSED":
      return "outline";
    default:
      return "outline";
  }
}

/**
 * Attendance state as a person should read it.
 *
 * These stay plain language rather than the raw token. `writing.md` §5's
 * "render the server's own token" governs the six states it *names* — `ACTIVE`,
 * `PAID`, `OPEN`, `OVERDUE`, `PENDING`, `FAILED` — and the attendance states
 * are not among them, so `invoice-status.ts`'s disposition for Stripe's tokens
 * applies: a vocabulary with no §5 row maps to plain language **once**, here,
 * rather than being re-cased at each call site. What §5 actually forbids is one
 * state reading differently on the two platforms, and nothing on mobile renders
 * an attendance status label to diverge from.
 */
export function attendanceStatusLabel(
  status: AttendanceStatusOrUnrecorded,
): string {
  switch (status) {
    case "PRESENT":
      return "Present";
    case "EXCUSED":
      return "Excused";
    case "ABSENT":
      return "Absent";
    case "LATE":
      return "Late";
    default:
      return "Unrecorded";
  }
}
