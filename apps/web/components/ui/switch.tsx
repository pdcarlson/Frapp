"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"
import { FOCUS_RING_OFFSET } from "@/components/ui/focus"

/*
 * The toggle, `spec/ui/design-system/components.md` §4.
 *
 * Track 50×30, thumb 24, full-round — **the only sanctioned pill in the
 * system** (§2 bans pill shapes everywhere else, and names this as the one
 * exception). The scaffold shipped it at 36×20 with a 16px thumb, which is
 * under the 44px touch floor on its own; the row it sits in still has to carry
 * the ≥44px hit area (§2), which is the caller's layout, not this primitive's.
 *
 * The thumb travels the track's inner width minus its own — 50 − 2×1px border
 * − 24 — so the 24px offset here is derived from the geometry above rather
 * than eyeballed, and stays correct as long as the two move together.
 *
 * ## Every state rule here is `enabled:`-scoped, deliberately
 *
 * `disabled:bg-card` and `data-[state=checked]:bg-primary` are both one class
 * plus one pseudo-class/attribute, so they tie on specificity and Tailwind's
 * own variant sort order decides — it emits the `data-` rules later, so they
 * win. The first cut of this file had exactly that bug: every disabled Switch
 * in Settings rendered in full `--primary` gold, indistinguishable from a live
 * control. `enabled:` makes the two selectors mutually exclusive, so there is
 * no tie left to lose.
 *
 * The focus indicator is the offset ring rather than the shared border swap for
 * the same class of reason: this control's border carries on/off, so a focus
 * rule that repaints it would either fight the state rule or erase the state.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "group peer inline-flex h-[30px] w-[50px] shrink-0 cursor-pointer items-center rounded-full border transition-colors",
      "enabled:data-[state=checked]:border-transparent enabled:data-[state=checked]:bg-primary",
      "enabled:data-[state=unchecked]:border-input enabled:data-[state=unchecked]:bg-accent",
      FOCUS_RING_OFFSET,
      "disabled:cursor-not-allowed disabled:border-border disabled:bg-card",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-6 w-6 rounded-full ring-0 transition-transform",
        "data-[state=checked]:translate-x-6 data-[state=checked]:bg-primary-foreground",
        "data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-muted",
        // The thumb is a child, so `disabled:` on the root never reaches it.
        // Radix stamps `data-disabled` on the root; `group-data-` carries two
        // ancestor classes and so outranks the sibling `data-[state]` rules
        // rather than tying with them.
        "group-data-[disabled]:bg-disabled"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
