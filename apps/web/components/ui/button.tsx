import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/ui/focus"

/*
 * The Signet button, `spec/ui/design-system/components.md` §3.
 *
 * Two things about this file are deliberate and easy to "fix" back into the
 * shadcn scaffold it replaced:
 *
 * 1. **There is no `outline` variant.** Under Signet the outlined button IS
 *    Secondary — card fill with the stronger `--input` hairline. The scaffold's
 *    `outline` (transparent fill over `bg-background`) painted a button DARKER
 *    than the card it sat on, inverting the elevation rule that carries depth
 *    on this surface (foundations.md §10). Keeping both names would have left
 *    two live spellings of one recipe, which the cutover rule forbids, so the
 *    call sites moved to `secondary` with this slice.
 * 2. **Every variant carries a transparent border in the base.** Primary,
 *    Ghost and Destructive draw no border, but all five take one when disabled
 *    (§3's states table), and a border that appears only in the disabled state
 *    shifts the label by a pixel as it lands. Reserving the box is cheaper than
 *    explaining the jitter.
 *
 * Label size is the `label` role — 14 — not the 15/14.5/14 ladder §3's size
 * table quotes. foundations.md §7 locks the type scale and calls an off-scale
 * size a defect, exactly as §1 there locks the radius map over the same board's
 * drawings; the sizes below differentiate by height and padding instead.
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent transition-colors",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    FOCUS_RING,
    // §3: one disabled recipe for every variant — card fill, neutral hairline,
    // disabled text. Never `opacity-50`, which dims the label and the fill by
    // the same amount and lands wherever the underlying colour happened to be.
    "disabled:pointer-events-none disabled:border-border disabled:bg-card disabled:text-disabled",
  ),
  {
    variants: {
      variant: {
        default:
          "bg-primary font-bold text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
        secondary:
          "border-input bg-card font-semibold text-foreground hover:bg-accent",
        tinted:
          "border-accent-border bg-accent-subtle font-bold text-accent-text hover:bg-accent-subtle-hover",
        ghost: "font-semibold text-accent-text hover:bg-accent-subtle",
        // Tint, never a solid red fill (§3). 14% at rest, ~20% on hover. The
        // label is the AA-lifted tone: `--destructive` on its own tint measures
        // 3.97:1 over `--popover`, which is what a destructive button in a
        // sheet or dialog actually sits on.
        destructive:
          "bg-destructive/[.14] font-bold text-destructive-text hover:bg-destructive/20",
        // Not one of §3's five: an inline text link that happens to be a
        // button. It opts out of the shared disabled fill, which would draw a
        // card-coloured slab around a run of text.
        link: "font-semibold text-accent-text underline-offset-4 hover:underline disabled:border-transparent disabled:bg-transparent",
      },
      size: {
        // §3's ladder. `sm` is the Inline size (44, action rows inside cards)
        // and `default` the standalone one; the names are the scaffold's and
        // are kept so 68 call sites do not churn for a rename.
        default: "h-12 px-4 text-sm",
        sm: "h-11 px-3.5 text-sm",
        // Square, and 44 rather than the app bar's 38, so an icon-only control
        // clears the touch-target floor (§2) on the 375px layout.
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
