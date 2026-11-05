import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A pre-auth text field whose label sits inside it and moves up out of the
 * way once the member focuses or types (Paul, 2026-11-05: the labelled stack
 * made the sign-in column taller than a laptop screen).
 *
 * The label is a real `<label for>`, so the field keeps its accessible name
 * whether or not the label has floated. The input's placeholder is a single
 * space so `:placeholder-shown` tells an empty field from a filled one, and
 * `:autofill` covers the browser filling a saved address before any input
 * event, which `:placeholder-shown` misses in some engines.
 *
 * 52px tall (the `Input` primitive is 48): the floated 12px label and the
 * 16px value need the extra 4px to sit on the grid without touching.
 */
export const FloatingField = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "placeholder"> & {
    id: string;
    label: string;
  }
>(({ id, label, className, ...props }, ref) => (
  <div className="relative">
    <Input
      ref={ref}
      id={id}
      placeholder=" "
      className={cn("peer h-13 pb-1.5 pt-5", className)}
      {...props}
    />
    <label
      htmlFor={id}
      className={cn(
        "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-muted-foreground",
        "motion-safe:transition-all motion-safe:duration-150",
        "peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-caption",
        "peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-caption",
        "peer-autofill:top-2 peer-autofill:translate-y-0 peer-autofill:text-caption",
      )}
    >
      {label}
    </label>
  </div>
));
FloatingField.displayName = "FloatingField";
