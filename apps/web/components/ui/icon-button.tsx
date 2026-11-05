import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { compactControlClassName } from "@/components/shared/table-controls";
import { cn } from "@/lib/utils";

/*
 * An icon-only control, `spec/ui/design-system/components.md` § Icon-only
 * actions.
 *
 * A secondary or row action whose glyph already says what it does (download,
 * dismiss, copy, edit, delete) draws the glyph alone. The word moves to the
 * two places that still need it:
 *
 * - `aria-label`, so a screen reader says "Download Bylaws, button", and
 * - the native `title`, so a mouse user who doesn't know the glyph can hover
 *   for it. Native rather than a tooltip primitive: #920 deleted the ShadCN
 *   tooltip, and `subscription-gate.tsx` carries its offline reason on
 *   `title` too.
 *
 * `label` is required, so there is no way to write an icon-only control with
 * nothing to announce. A caller's own `title` wins over the label, which is
 * how `gate.controlProps()` gets "Reconnect to make changes." onto a disabled
 * control. It returns `title: undefined` when online, and that falls back to
 * the label rather than wiping it, which a bare `title=` before the spread
 * would have done.
 *
 * Paint defaults to `quiet`: a row action sits in the text's own tone and
 * lights up on hover, so a column of them never outshines the row.
 */
export interface IconButtonProps extends Omit<
  ButtonProps,
  "size" | "aria-label"
> {
  /** What the control does, for the screen reader and the hover tooltip. */
  label: string;
  /**
   * `row` (the default) is 32px on a mouse and the 44px touch floor on a
   * finger, for list rows and card footers. `standalone` is 44 everywhere.
   */
  size?: "row" | "standalone";
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { label, title, size = "row", variant = "quiet", className, ...props },
    ref,
  ) => (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      aria-label={label}
      title={title ?? label}
      className={cn(size === "row" && compactControlClassName, className)}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";

export { IconButton };
