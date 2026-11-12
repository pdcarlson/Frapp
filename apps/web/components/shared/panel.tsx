"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { IconButton } from "@/components/ui/icon-button";
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
 */

/**
 * **Docked: the panel inside its page** (Paul, 2026-11-11: the sheet "feels
 * intrusive and I can't see any other info while I fill it out"). A page that
 * owns the record (Events owns its events) opens the panel `docked`: it takes
 * the place of the page in the tool column, beside chat, with nothing dimmed
 * and nothing blocked. Chat and the rest of the app stay live while the form
 * is open, the way Gmail's compose window, Notion's side peek and Slack's
 * thread pane leave the conversation readable. Its header is the tool page
 * header's 48px row with a back arrow, as chat's thread pane has
 * (`thread-panel.tsx`). Below the side-by-side width the tool column is the
 * whole page, so docked is a full page there.
 *
 * A panel opened from somewhere with no page of its own (`/event` in chat)
 * stays the sheet. A yes/no question stays a centred dialog: there, blocking
 * the screen is the point.
 */
type PanelDock = {
  onClose: () => void;
  backLabel: string;
  titleId: string;
};

const PanelDockContext = React.createContext<PanelDock | null>(null);

/** The tool column is the shell's, present for the page's whole life. */
const noSubscribe = () => () => undefined;

/** Where docked panels land (`dashboard-shell.tsx`). */
const TOOL_COLUMN_SELECTOR = "[data-tool-column]";

/**
 * The panel's root: the sheet, or with `docked` the page's own column. Use it
 * in place of `Sheet` so a caller switches with one prop.
 */
export function Panel({
  open,
  onOpenChange,
  docked = false,
  backLabel = "Back",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docked?: boolean;
  /** The back arrow's name when docked: where it goes ("Back to events"). */
  backLabel?: string;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  // `undefined` on the server and in the first hydrating render, so the
  // markup matches; then the column, or `null` when there is none.
  const column = React.useSyncExternalStore<Element | null | undefined>(
    noSubscribe,
    () => (docked ? document.querySelector(TOOL_COLUMN_SELECTOR) : null),
    () => undefined,
  );

  const dock = React.useMemo<PanelDock>(
    () => ({ onClose: () => onOpenChange(false), backLabel, titleId }),
    [onOpenChange, backLabel, titleId],
  );

  // Docked with no tool column to land in (a page outside the shell, a
  // test) falls back to the sheet rather than showing nothing.
  if (!docked || column === null) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {children}
      </Sheet>
    );
  }
  if (!open || !column) return null;
  return createPortal(
    <PanelDockContext.Provider value={dock}>
      {children}
    </PanelDockContext.Provider>,
    column,
  );
}

/**
 * The docked panel's box: over the whole tool column (its header and its
 * page), which is left inert underneath so Tab and a screen reader stay in
 * the form. Focus moves in on open and goes back where it was on close.
 * Escape goes back, unless a field or an open popover had it first.
 */
function DockedPanel({
  dock,
  className,
  children,
}: {
  dock: PanelDock;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const box = ref.current;
    const column = box?.parentElement;
    if (!box || !column) return;
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const covered = Array.from(column.children).filter(
      (child): child is HTMLElement =>
        child !== box && child instanceof HTMLElement && !child.inert,
    );
    for (const child of covered) child.inert = true;
    box.focus({ preventScroll: true });
    return () => {
      for (const child of covered) child.inert = false;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, []);

  return (
    <section
      ref={ref}
      aria-labelledby={dock.titleId}
      data-docked-panel=""
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select, [contenteditable]"))
          return;
        event.preventDefault();
        event.stopPropagation();
        dock.onClose();
      }}
      className={cn(
        "absolute inset-0 z-20 flex flex-col bg-background outline-none",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** The panel's one width (§ Surface size). */
const PANEL_WIDTH_CLASS = "sm:w-[576px] sm:max-w-[576px]";

export const PanelContent = React.forwardRef<
  React.ElementRef<typeof SheetContent>,
  Omit<React.ComponentPropsWithoutRef<typeof SheetContent>, "side">
>(({ className, ...props }, ref) => {
  const dock = React.useContext(PanelDockContext);
  if (dock) {
    return (
      <DockedPanel dock={dock} className={className}>
        {props.children}
      </DockedPanel>
    );
  }
  return (
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
  );
});
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
  const dock = React.useContext(PanelDockContext);
  if (dock) {
    // The tool page header's row (`tool-page-header.tsx`), so the form's title
    // sits level with chat's channel header beside it. The title truncates
    // here: the row is one line high, and a long name is in the body too.
    return (
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-4">
        <IconButton
          label={dock.backLabel}
          onClick={dock.onClose}
          className="shrink-0 text-muted-foreground"
        >
          <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
        </IconButton>
        <h2
          id={dock.titleId}
          className={cn(
            "min-w-0 flex-1 truncate text-body font-semibold",
            className,
          )}
        >
          {children}
        </h2>
        {actions ? (
          <div className="flex shrink-0 items-center">{actions}</div>
        ) : null}
      </div>
    );
  }
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
