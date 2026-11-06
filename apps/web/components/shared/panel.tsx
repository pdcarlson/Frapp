"use client";

import * as React from "react";
import { SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The panel: the web surface for content that should be big.
 * `spec/ui/design-system/components.md` § Surface size owns the rule; this is
 * its implementation.
 *
 * A dialog is for a question or a short form that fits without scrolling. As
 * soon as a surface scrolls, holds a list that grows, or shows a whole record
 * (an event, a member, a long form, every live invite), it is a panel: a
 * full-height sheet from the right edge, one width everywhere, with a title row
 * and a footer that stay put while the body between them scrolls. The owner
 * called the scrolling max-width dialogs cramped (2026-11-05), and the five
 * forms that had drifted into them carried three different width and height
 * caps between them.
 *
 * **One width, 576px.** It is the width the event and member detail sheets
 * already had, so the forms that open from them (Edit event opens from the
 * event panel) slide in at exactly the same size and read as the same surface
 * turning into its editor rather than a second box on top. Below `sm` it is
 * the whole viewport, which holds the 375px floor.
 *
 * **The bands are the upload sheet's** (`upload-sheet.tsx`, board `1j`): a
 * 56px title row at 18/700 with `pr-14` clearing the close button, a body at
 * the 20px inset, a right-aligned footer at the same inset. A panel is that
 * sheet at full height, so it uses the same rhythm rather than inventing a
 * second one. The close button `SheetContent` draws is a 26px box (a 16px
 * glyph, `p-1` and a 1px border) at `top-4`, so its centre sits at 29px, a
 * pixel under the 56px row's centre.
 *
 * **Not for the per-page settings drawer** (`page-settings-drawer.tsx`), which
 * is `4c`'s 400px tool drawer that sits beside the page while you change it.
 * A panel holds content; the drawer holds switches.
 */

/** The panel's one width (§ Surface size). */
const PANEL_WIDTH_CLASS = "sm:w-[576px] sm:max-w-[576px]";

export const PanelContent = React.forwardRef<
  React.ElementRef<typeof SheetContent>,
  Omit<React.ComponentPropsWithoutRef<typeof SheetContent>, "side">
>(({ className, ...props }, ref) => (
  <SheetContent
    ref={ref}
    side="right"
    className={cn(
      "flex w-full flex-col gap-0 p-0",
      PANEL_WIDTH_CLASS,
      className,
    )}
    {...props}
  />
));
PanelContent.displayName = "PanelContent";

/**
 * The title row: 56px for a one-line title. Pinned: it sits outside the
 * scrolling body, so the title and the close button stay on screen however far
 * the body scrolls. Before this, the event and member sheets scrolled as one
 * block and took their close button with them.
 *
 * The title wraps rather than truncating: it is often a record's name (an
 * event can be 255 characters), and the panel shows it nowhere else. `pr-14`
 * clears the close button.
 *
 * `actions` are the record's own icon controls (`IconButton`s), drawn in the
 * row beside the close rather than as a toolbar opening the body
 * (components.md § Chrome weight). Their box is the title's first line, 26px,
 * so at either pointer size (36px under a mouse, 44px under a finger) they
 * centre on that line and on the close button however far the title wraps.
 */
export function PanelHeader({
  children,
  actions,
  className,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-14 shrink-0 items-center gap-2 py-[15px] pl-5 pr-14",
        className,
      )}
    >
      <SheetTitle className="min-w-0 flex-1 break-words text-lg font-bold leading-[26px]">
        {children}
      </SheetTitle>
      {actions ? (
        <div className="flex h-[26px] shrink-0 items-center self-start">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The scrolling band. `min-h-0` lets the flex child shrink below its content
 * so it scrolls instead of pushing the footer off the screen.
 *
 * Render it as the form (`asChild` is not needed: pass `as="form"`) when the
 * footer's submit button should submit it.
 */
export function PanelBody<T extends "div" | "form" = "div">({
  as,
  className,
  ...props
}: { as?: T } & React.ComponentPropsWithoutRef<T>) {
  const Component = (as ?? "div") as React.ElementType;
  return (
    <Component
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-1",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The footer: the panel's primary action, right-aligned, outside the scroll so
 * it never scrolls away. A hairline separates it from a body that scrolls
 * under it, which the upload sheet doesn't need because its body is short.
 *
 * Not `SheetFooter`, which stacks `flex-col-reverse` below `sm` and puts the
 * primary action on top: one row at every width, as `UploadSheetFooter`.
 */
export function PanelFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}
