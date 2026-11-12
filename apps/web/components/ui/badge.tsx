import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";

/*
 * Badges and chips, `spec/ui/design-system/components.md` §5.
 *
 * Geometry is one recipe — height 24 (the Chip step of foundations.md §9's
 * control size scale; 28 until 2026-11-05), radius 8, padding-x 8, caption
 * text at 600 — and the kinds differ only in fill, border and text, which is what keeps
 * a status pill and an accent chip the same object at a glance.
 *
 * The names are the scaffold's; the recipes are §5's plus the neutral count
 * badge foundations.md §5 specs for channel unread:
 *
 *   default     Accent      — accent-worthy stats: points, active filters
 *   secondary   Neutral     — counts and unread markers; the `--input` fill
 *   outline     Hairline    — quiet metadata that must not read as a status
 *   success     Semantic    — status only, on its `--*-tint` fill, never a solid
 *   warning     Semantic    — "
 *   destructive Semantic    — "
 *   info        Semantic    — " (a task In progress, #4133)
 *   mention     Mention/DM  — "you were addressed", and nothing else
 *
 * `success` and `warning` landed with the Directory & Finance slice of #920,
 * which brought the first surface that has to state a *status*: `PAID`, `OPEN`,
 * `OVERDUE`. Until then §5's Semantic kind shipped one hue, because chat only
 * ever needed danger — and `/billing` was painting `PAID` in `default`, i.e. in
 * the chapter accent. That is what §5 means by "status color is never
 * decorative": measured across the seeded chapters, a green-accented chapter's
 * accent badge sits 1.08:1 from the success tint and a red-accented one 1.13:1
 * from the danger tint, so the chapter that most needs `PAID` to read as paid is
 * the chapter where it reads as overdue.
 *
 * Only danger and info need §1's lift. Measured on the new ladder
 * (foundations.md §2), each hue on its own 13% tint across the four steps:
 * `--success` 4.79–6.08:1 and `--warning` 5.27–6.81:1 both clear the 4.5:1
 * gate, so they render in the semantic hue itself and need no twin.
 * `--destructive` is 3.82–4.85:1 (4.222 on `--card`, 3.817 on `--popover`),
 * which is why it has `--destructive-text` — that twin measures 5.07–6.45:1 on
 * the same tints and clears throughout. The fill is the `--*-tint` token, an
 * `rgba()` with no browser floor, never an alpha utility, whose fallback below
 * the `color-mix` floor was the solid hue (#2376, foundations §5). Measured
 * from the tokens in `components/shared/status-tint-contrast.spec.ts`.
 *
 * `info` landed with its first call site, the chat task card's In progress
 * badge (#4133, 2026-11-12). Solid `--info` misses the gate on its own tint
 * (`components/billing/status-contrast.spec.ts` keeps that number), so, like
 * danger, the text is the lifted `--info-text` (#61A7FF since the 2026-11-12
 * ladder) on `--info-tint`, which clears 4.5:1 over every step, `--popover`
 * included, measured in `components/shared/status-tint-contrast.spec.ts`.
 *
 * `mention` landed with the chat slice of #920, which brought its first call
 * sites (`components/chat/channel-list.tsx`). It is the *neutral* badge with the
 * fill swapped and the text set to white — fill and text are the only
 * difference, so badge geometry stays one recipe (foundations.md §5). Its red
 * is fixed and never accent-derived: an @-mention or a DM must read identically
 * under every chapter seed, including a red-accented one. It is also the one
 * kind that is not a status — do not reach for it to mean "urgent".
 */
const badgeVariants = cva(
  cn(
    "inline-flex h-6 items-center rounded-xs border px-2 text-caption font-semibold transition-colors",
    FOCUS_RING,
  ),
  {
    variants: {
      variant: {
        default: "border-accent-border bg-accent-subtle text-accent-text",
        secondary: "border-transparent bg-input text-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-transparent bg-success-tint text-success",
        warning: "border-transparent bg-warning-tint text-warning",
        // AA-lifted text on the tint — `--destructive` on its own 13% tint is
        // 4.22:1 over `--card`, the surface a status badge normally sits on.
        destructive:
          "border-transparent bg-destructive-tint text-destructive-text",
        // Lifted `--info-text` on the info tint: a task In progress (#4133).
        info: "border-transparent bg-info-tint text-info-text",
        mention: "border-transparent bg-mention text-mention-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * The §5 kinds, derived from the variant map rather than restated.
 *
 * Every domain status mapper returns this, so deleting a variant here becomes a
 * compile error in each of them instead of a silent fallback. It lives on the
 * primitive because every status mapper needs it — `billing/invoice-status.ts`,
 * `events/attendance-status.ts`, `service/service-status.ts`,
 * `study/study-status.ts`, `geofences/geofence-status.ts` and
 * `tasks/task-status.ts` among them — and a local copy per mapper is the drift
 * `ui/typography.ts` was hoisted to stop.
 */
export type BadgeKind = NonNullable<BadgeProps["variant"]>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
