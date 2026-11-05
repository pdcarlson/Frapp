import type { BadgeKind } from "@/components/ui/badge";

/**
 * Study-zone enabled state → the §5 badge kind that states it.
 *
 * `geofences-admin-page.tsx` rendered this as `is_active ? "default" :
 * "outline"`, and `default` is the chapter accent — the same defect #1202 names
 * for attendance, reached by an inline ternary rather than a mapper.
 * `writing.md` §5 lists `ACTIVE` in the status vocabulary the rule governs, so
 * this is squarely inside it rather than an extension of it.
 *
 * Active is foundations §5's "inside-zone" success. Disabled keeps §5's
 * Hairline kind, and deliberately does not become a semantic hue: a zone an
 * admin switched off is not a failure, a warning, or a degraded state — it is
 * the *absence* of an active zone, which is the same reading `invoice-status.ts`
 * gives `DRAFT`. Painting an intentional administrative choice in danger red
 * would be the decorative use of a semantic hue §5 forbids.
 */
export function geofenceStatusKind(isActive: boolean): BadgeKind {
  return isActive ? "success" : "outline";
}

/** The label beside {@link geofenceStatusKind}, said once here. */
export function geofenceStatusLabel(isActive: boolean): string {
  return isActive ? "Active" : "Disabled";
}

/**
 * A study zone row's meta line: its four reward rules, as
 * "1 pt every 30 min · min 15 min session · 5 min pause grace".
 *
 * A rule the row does not carry drops out of the line rather than printing a
 * placeholder or an invented default (`spec/ui/web-dashboard/README.md`
 * § Page grammar, "An absent value is absent"). The row used to fill a missing
 * pause grace with `5`, which states a rule the server never sent.
 */
export function studyZoneRulesLine(zone: {
  points_per_interval?: number | null;
  minutes_per_point?: number | null;
  min_session_minutes?: number | null;
  pause_grace_minutes?: number | null;
}): string {
  const rate =
    zone.points_per_interval != null && zone.minutes_per_point != null
      ? `${zone.points_per_interval} pt every ${zone.minutes_per_point} min`
      : null;
  const minSession =
    zone.min_session_minutes != null
      ? `min ${zone.min_session_minutes} min session`
      : null;
  const grace =
    zone.pause_grace_minutes != null
      ? `${zone.pause_grace_minutes} min pause grace`
      : null;
  return [rate, minSession, grace].filter(Boolean).join(" · ");
}
