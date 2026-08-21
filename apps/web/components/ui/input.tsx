import * as React from "react"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/ui/focus"

/*
 * Text input, `spec/ui/design-system/components.md` §4.
 *
 * Height 48, radius 12, padding-x 14, the `--surface-1` fill sitting one layer
 * below the card or sheet that contains it, and the shared focus recipe.
 *
 * Two things the shadcn scaffold got wrong on this surface:
 *
 * - It shipped `bg-transparent`, so the input took whatever was behind it and
 *   the "fill one layer below its container" rule (§4) held nowhere.
 * - It shipped `md:text-sm`, dropping the value to 14px on every desktop
 *   viewport. foundations.md §7 states outright that body text MUST NOT render
 *   below 16, and a form field's value is body text.
 *
 * The error state keys off `aria-invalid` rather than a prop, so the styling
 * cannot get out of step with what assistive tech is told. §4 also requires the
 * caption to be wired with `aria-describedby` — that half belongs to the form
 * that owns the caption and is not something this primitive can do for it.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-12 w-full rounded-md border border-input bg-surface-1 px-3.5 py-1 text-base text-foreground caret-primary transition-colors",
          "file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground",
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
  }
)
Input.displayName = "Input"

export { Input }
