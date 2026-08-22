import type { BadgeKind } from "@/components/ui/badge";

export type StudySessionStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "EXPIRED"
  | "PAUSED_EXPIRED"
  | "LOCATION_INVALID";

/**
 * Study-session state → the §5 badge kind that states it.
 *
 * `study-page.tsx` carried this as an inline ternary mapping `COMPLETED` to
 * `default` (the chapter accent) and `ACTIVE` to `secondary` (§5's Neutral
 * count badge), with **everything else falling to Hairline** — and that last
 * part is the defect worth naming, because it is not the accent one.
 *
 * The split is not a judgement call: `writing.md` §7 already states it, and
 * this mapper is that sentence in code. "A close that **awards** points
 * (`COMPLETED`, `PAUSED_EXPIRED`) must never read as a loss, and one that
 * awards nothing (`EXPIRED`, `LOCATION_INVALID`) must say so." So the danger
 * hue belongs to exactly two states, and `PAUSED_EXPIRED` is deliberately not
 * one of them — a session closed by the grace window kept the member's time,
 * and §7's own notice copy says so ("You kept the time you studied before it
 * paused"). Painting it in danger would be the repaint telling a member they
 * lost hours the server credited.
 *
 * It still is not a clean close, so it takes warning rather than success:
 * foundations §5's "degraded", one step off the outcome the member intended.
 * `EXPIRED` and `LOCATION_INVALID` award nothing and take danger, which is also
 * what the screen already did one layer up — `study-page.tsx` raises a
 * **destructive** toast for exactly these, so before this change the badge and
 * the toast stated opposite things about the same session.
 *
 * `ACTIVE` takes success on foundations §5's `--success` role, which reads
 * "Paid, confirmed, checked-in, **inside-zone**" — a running session is the
 * inside-zone case by name, and the Canvas reference draws the live session's
 * zone indicator green (s10). It shares the hue with `COMPLETED` because both
 * are outcomes in good standing; the label is what separates them, which is
 * §5's own division of labour between hue and word.
 *
 * Only danger needs §1's lift and only on its tint; `Badge` applies it
 * (`components.md` §5).
 */
export function studySessionStatusKind(status: StudySessionStatus): BadgeKind {
  switch (status) {
    case "ACTIVE":
    case "COMPLETED":
      return "success";
    case "PAUSED_EXPIRED":
      return "warning";
    case "EXPIRED":
    case "LOCATION_INVALID":
      return "destructive";
    default:
      return "outline";
  }
}
