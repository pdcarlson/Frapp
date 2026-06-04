"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "type"
  > {
  /** Fired with the next checked state when the box is toggled. */
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * Minimal checkbox built on a native `<input type="checkbox">`. We deliberately
 * avoid pulling in `@radix-ui/react-checkbox`: a native input keeps the
 * dependency surface small (the onboarding wizard already uses a native
 * `<input type="color">`), is form-associable, and is accessible for free. The
 * visible box is a styled, aria-hidden overlay; the real input sits on top,
 * transparent, so pointer, focus, and keyboard all behave natively.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
    <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none flex h-4 w-4 items-center justify-center rounded-sm border border-primary shadow-sm transition-colors",
          "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          "peer-disabled:opacity-50",
          checked ? "bg-primary text-primary-foreground" : "bg-background",
        )}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
    </span>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
