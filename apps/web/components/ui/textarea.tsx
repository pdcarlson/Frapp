import * as React from "react"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/ui/focus"

/*
 * The multi-line member of the §4 input family. `components.md` draws only the
 * single-line field, so this composes from the same tokens per §2 — same fill,
 * hairline, radius, focus recipe and error state — and differs only in taking
 * a min-height instead of a fixed one. Same `md:text-sm` removal as `input.tsx`:
 * a textarea's contents are body text and body text never renders below 16
 * (foundations.md §7).
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md border border-input bg-surface-1 px-3.5 py-3 text-base text-foreground caret-primary transition-colors",
        "placeholder:text-muted-foreground",
        FOCUS_RING,
        "enabled:aria-[invalid=true]:border-destructive enabled:aria-[invalid=true]:focus-visible:border-destructive enabled:aria-[invalid=true]:focus-visible:ring-destructive/25",
        "disabled:cursor-not-allowed disabled:border-border disabled:text-disabled",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
