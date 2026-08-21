"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { FOCUS_RING, FOCUS_RING_OFFSET } from "@/components/ui/focus"

/*
 * Tabs, `spec/ui/design-system/components.md` §6: **underline style only — no
 * segmented pill controls.**
 *
 * The shell slice left this as a filled rail with a tinted active segment,
 * noting the underline treatment would land with the primitives slice. This is
 * that: the list is a hairline rule, the active item is 600 in `--foreground`
 * over a 2px accent underline, and inactive items are 400 in `--muted` lifting
 * to `--muted-foreground` on hover. The rail, its `bg-secondary` fill and the
 * `--accent-subtle` active fill are all gone rather than kept alongside.
 *
 * Focus is the offset ring, not the shared border swap. This trigger's bottom
 * border IS the selected indicator, so `focus-visible:border-primary` would
 * paint a focused-but-unselected tab with the exact 2px gold underline that
 * means "selected" — and since the shared ring is only ~1.3:1 on its own, that
 * underline would be the only cue a keyboard user got. The offset ring is
 * unambiguous against both states.
 *
 * Inactive labels take `--muted-foreground` rather than §6's drawn `#78716A`.
 * `--muted` on this ladder measures 3.3–4.0:1 depending on the surface the row
 * sits on, under README §6's 4.5:1 release gate; §1's rounding rule ("lift a
 * drawn tone that fails the gate one step up the §4 ladder") applies, and the
 * hover lift moves up with it to `--foreground` so the two stay distinct.
 *
 * Two numbers are rounded onto the locked maps instead of transcribed:
 * §6 draws the item gap at 22 and the vertical padding at 11, which are off
 * foundations.md §9's 4px grid; `gap-6` (24) and `py-3` (12) are the adjacent
 * grid steps, and the 12 also lands the item at exactly the 44px hit area §6
 * requires on touch.
 */
const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex w-full items-center justify-start gap-6 border-b border-border text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // `-mb-px` pulls the item's own bottom border over the list's hairline so
      // the active underline replaces the rule rather than stacking under it.
      "-mb-px inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-t-xs border-b-2 border-transparent px-1 py-3 text-sm font-normal transition-colors",
      "enabled:hover:text-foreground",
      // `enabled:`-scoped so `disabled:text-disabled` below is not competing
      // with an equal-specificity `data-[state]` rule that Tailwind emits later.
      "enabled:data-[state=active]:border-primary enabled:data-[state=active]:font-semibold enabled:data-[state=active]:text-foreground",
      FOCUS_RING_OFFSET,
      "disabled:pointer-events-none disabled:text-disabled",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-4 rounded-md", FOCUS_RING, className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
