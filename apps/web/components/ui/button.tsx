import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/ui/focus";

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
 * Every size is pointer-aware (§3, corrected 2026-11-05): the mouse gets the
 * dense heights the sidebar already used, and `pointer-coarse` gives every
 * size the 44 touch height, so nothing a finger hits drops under the floor
 * (§2). The steps are foundations.md §9's control size scale.
 *
 * Label size is the `label` role — 14 — not the 15/14.5/14 ladder §3's size
 * table quotes. foundations.md §7 locks the type scale and calls an off-scale
 * size a defect, exactly as §1 there locks the radius map over the same board's
 * drawings; the sizes below differentiate by height and padding instead.
 */
/*
 * The Small step (foundations.md §9): 36 to a mouse, 44 to a finger. Padding
 * does not change with the pointer on purpose: a `pointer-coarse:px-*` class
 * survives `cn()` next to a caller's plain `px-0` (tailwind-merge only merges
 * classes with the same variant), so link-style buttons would grow a box on
 * touch. Only the height splits, and a caller that cancels it says so with
 * `pointer-coarse:h-auto`.
 */
const SMALL = "h-9 px-3 text-sm pointer-coarse:h-11";

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
        // `bg-clip-padding` is the focus indicator's other half (#2398). With
        // the default `border-box` clip the fill paints under the reserved
        // transparent border, so focus would only move that 1px from accent-9
        // to accent-11 (1.09:1 on the worst seed). Clipped, the border shows
        // the surface at rest and accent-11 on focus: `focus-contrast.spec.ts`.
        default:
          "bg-primary bg-clip-padding font-bold text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
        // Hover is `--card-hover`, a lift above the top of the ladder, not
        // the elevated step: that step is `--popover`, so inside a dialog it
        // painted the button in the dialog's own colour (#1220). Measured in
        // `components/shared/elevation-contrast.spec.ts`, and
        // `app/global-error.tsx` hand-copies this string class for class.
        secondary:
          "border-input bg-card font-semibold text-foreground hover:bg-card-hover",
        tinted:
          "border-accent-border bg-accent-subtle font-bold text-accent-text hover:bg-accent-subtle-hover",
        ghost: "font-semibold text-accent-text hover:bg-accent-subtle",
        // Not one of §3's five either: a row's secondary actions (Edit,
        // Delete, Remove, an icon). Ghost paints the chapter accent, so a
        // column of "Delete" links read as the brightest thing on the page;
        // these sit in the text's own tone and light up only on hover. The
        // dialog and sheet close buttons were already this recipe.
        quiet:
          "font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground",
        // Tint, never a solid red fill (§3): `--destructive-tint` (13%) at
        // rest, `--destructive-tint-hover` (20%) on hover. The label is the
        // AA-lifted tone: `--destructive` on its own tint measures 3.82:1 over
        // `--popover`, which is what a destructive button in a sheet or dialog
        // actually sits on.
        destructive:
          "bg-destructive-tint font-bold text-destructive-text hover:bg-destructive-tint-hover",
        // Not one of §3's five: an inline text link that happens to be a
        // button. It opts out of the shared disabled fill, which would draw a
        // card-coloured slab around a run of text.
        link: "font-semibold text-accent-text underline-offset-4 hover:underline disabled:border-transparent disabled:bg-transparent",
      },
      size: {
        // §3's ladder. `sm` is the Inline size (36 to a mouse, 44 to a finger:
        // action rows inside cards) and `default` the standalone one (40, 44);
        // the names are the scaffold's and are kept so 68 call sites do not
        // churn for a rename.
        default: "h-10 px-4 text-sm pointer-coarse:h-11",
        sm: SMALL,
        // Square: 36 to a mouse, and 44 to a finger so an icon-only control
        // clears the touch-target floor (§2) on the 375px layout.
        icon: "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11",
        // A toolbar row's controls (the PageActions row, filters, search):
        // §3's Compact on a mouse, the 44 touch floor on a finger, which is
        // the README's row rule. At 48 the primary action stood taller than
        // the page's title row and every list row under it.
        // Since 2026-11-05 the same step as `sm`; both names stay so the call
        // sites read as what they are.
        toolbar: SMALL,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
