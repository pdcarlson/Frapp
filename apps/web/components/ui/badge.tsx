import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/ui/focus"

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
 * Only danger needs §1's lift. On its own 13% tint `--success` measures
 * 5.02–6.46:1 and `--warning` 5.57–7.15:1 across the whole ladder, both clear of
 * the 4.5:1 gate, so they render in the semantic hue itself and need no
 * `--destructive-text` twin. `--destructive` is 4.04–4.39:1 on `--card` and
 * `--popover`, which is why it has one. (`--info` would need one too — 3.65:1 on
 * `--popover` — but it has no call site, and a kind with no call sites is
 * exactly what slice 2 deleted seven of. Measured in
 * `components/billing/status-contrast.test.ts` so the first consumer inherits
 * the number rather than the defect.)
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
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
