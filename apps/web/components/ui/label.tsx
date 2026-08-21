"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * The `label` type role from `spec/ui/design-system/foundations.md` §7 — 14 at
 * 600. It was `font-medium` (500), which is not one of the three weights Signet
 * ships: Figtree is loaded at 400/600/700 only, so 500 was being synthesised by
 * the browser from the nearest face rather than rendered.
 *
 * Disabled follows the field it labels onto `--disabled` instead of dimming
 * with opacity, so a disabled label reads as the same grey everywhere rather
 * than as 70% of whatever it happened to sit on.
 */
const labelVariants = cva(
  "text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:text-disabled"
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
