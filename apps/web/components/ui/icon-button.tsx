import * as React from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
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
 * nothing to announce. A caller's own `title` is added after the label, never
 * in place of it: `gate.controlProps()` puts "Reconnect to make changes." on
 * a control it disables, and the tooltip has to say both what the glyph is and
 * why it's off. Online the gate passes `title: undefined`, which leaves the
 * label alone rather than wiping it, as a bare `title=` before the spread
 * would have.
 *
 * Disabled, it still takes the pointer. Button's shared disabled recipe sets
 * `pointer-events: none`, which stops the hover that shows a native tooltip,
 * so a gated row was left as grey glyphs nobody could identify. The
 * `disabled` attribute already blocks the click.
 *
 * Paint defaults to `quiet`: a row action sits in the text's own tone and
 * lights up on hover, so a column of them never outshines the row.
 *
 * Size is the Small step of `foundations.md` §9's control size scale, 36 to a
 * mouse and 44 to a finger, wherever the control sits. It is set here rather
 * than inherited from Button's `icon` size so the step holds whichever way
 * that size moves.
 */
export interface IconButtonProps extends Omit<
  ButtonProps,
  "size" | "aria-label"
> {
  /** What the control does, for the screen reader and the hover tooltip. */
  label: string;
}

/** foundations.md §9's Small step: 36 to a mouse, 44 to a finger. */
const SMALL_SQUARE = "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11";

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, title, variant = "quiet", className, ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      aria-label={label}
      title={title ? `${label}. ${title}` : label}
      className={cn(
        "disabled:pointer-events-auto disabled:cursor-not-allowed",
        SMALL_SQUARE,
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";

export { IconButton };
