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
 *   default     Accent   — accent-worthy stats: points, active filters
 *   secondary   Neutral  — counts and unread markers; the `--input` fill
 *   outline     Hairline — quiet metadata that must not read as a status
 *   destructive Semantic — status only, as a 13% tint and never a solid fill
 *
 * There is deliberately no `mention` kind here. Mention/DM red is the neutral
 * badge with the fill swapped and the text set to white (foundations §5), and
 * its only consumers are the chat surfaces the chat slice of #920 owns — a
 * variant with no call sites is what this slice is deleting elsewhere.
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
        // AA-lifted text on the tint — `--destructive` on its own 13% tint is
        // 4.39:1 over `--card`, the surface a status badge normally sits on.
        destructive:
          "border-transparent bg-destructive/[.13] text-destructive-text",
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
