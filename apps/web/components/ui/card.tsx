import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * Cards, `spec/ui/design-system/components.md` §8: card fill, 1px neutral
 * hairline, radius 16, **padding 16**. The scaffold padded every slot at 24
 * (`p-6`), which on the 375px floor spent 48 of 375 on gutters before any
 * content; §8's 16 is also foundations.md §9's "between components" step, so
 * the card's inner rhythm matches the page's.
 *
 * `rounded-xl` is the 16 step, not Tailwind's stock 12 — the shared preset
 * remaps the whole radius scale onto foundations §8. A dense or small card
 * takes `rounded-lg` (14) at the call site.
 *
 * Cards never carry shadows; a raised card is a lighter surface. Nothing here
 * sets one, and `--shadow-*` are all `none` on this surface so a stray
 * `shadow-sm` inherited from a screen is inert until its slice deletes it.
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border border-border bg-card text-card-foreground",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-2 p-4", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    // §8 draws the title at 16.5/700. 16.5 is not on foundations §7's locked
    // scale; `body` (16) at 700 is the adjacent size and keeps the weight §8
    // actually distinguishes cards by.
    className={cn("text-base font-bold leading-none", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    // §8: action rows use Inline buttons with an 8px gap.
    className={cn("flex items-center gap-2 p-4 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
