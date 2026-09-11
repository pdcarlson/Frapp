import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";

/*
 * Badges and chips, `spec/ui/design-system/components.md` §5.
 *
 * Geometry is one recipe — height 28, radius 8, padding-x 10, caption text at
 * 600 — and the kinds differ only in fill, border and text, which is what keeps
 * a status pill and an accent chip the same object at a glance.
 *
 * The names are the scaffold's; the recipes are §5's plus the neutral count
 * badge foundations.md §5 specs for channel unread:
 *
 *   default     Accent      — accent-worthy stats: points, active filters
 *   secondary   Neutral     — counts and unread markers; the `--input` fill
 *   outline     Hairline    — quiet metadata that must not read as a status
 *   success     Semantic    — status only, as a 13% tint and never a solid fill
 *   warning     Semantic    — "
 *   destructive Semantic    — "
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
 * which is why it has `--destructive-text` — that twin measures 4.80–6.12:1 on
 * the same tints and clears throughout.
 *
 * `--info` is 3.45–4.36:1 on its own tint (3.807 on `--card`, 3.446 on
 * `--popover`) and now has `--info-text` (#4C93F8) — added when the greenfield
 * ladder took solid `--info` under the gate on plain `--card` and `--popover`
 * too. **Read the twin's own limit before building an info badge**: on the
 * *tint* it measures 4.08–5.16:1, so it clears on `--background` and
 * `--surface-1` but NOT on a `--popover`-seated tint (4.08). A badge that has
 * to sit in a dialog or menu needs a further lift or a solid fill; the token as
 * it stands does not cover that case, and there is still no `--info` call site
 * to have forced the question. Measured in
 * `components/billing/status-contrast.spec.ts` so the first consumer inherits
 * the number rather than the defect.
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
    // 12.5 is the `caption` role from foundations.md §7, not an off-scale size.
    "inline-flex h-7 items-center rounded-xs border px-2.5 text-[12.5px] font-semibold transition-colors",
    FOCUS_RING,
  ),
  {
    variants: {
      variant: {
        default: "border-accent-border bg-accent-subtle text-accent-text",
        secondary: "border-transparent bg-input text-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-transparent bg-success/[.13] text-success",
        warning: "border-transparent bg-warning/[.13] text-warning",
        // AA-lifted text on the tint — `--destructive` on its own 13% tint is
        // 4.39:1 over `--card`, the surface a status badge normally sits on.
        destructive:
          "border-transparent bg-destructive/[.13] text-destructive-text",
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
 * primitive because five mappers now need it — `billing/invoice-status.ts`,
 * `events/attendance-status.ts`, `service/service-status.ts`,
 * `study/study-status.ts` and `geofences/geofence-status.ts` — and five local
 * copies of one type is the drift `ui/typography.ts` was hoisted to stop.
 */
export type BadgeKind = NonNullable<BadgeProps["variant"]>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
