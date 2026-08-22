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
