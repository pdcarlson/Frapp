"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
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
  /** The id `PanelDescription` takes, read as the panel's description. */
  descriptionId: string;
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
  const descriptionId = React.useId();
  useOpenerTracking(docked);
  // `undefined` on the server and in the first hydrating render, so the
  // markup matches; then the column, or `null` when there is none.
  const column = React.useSyncExternalStore<Element | null | undefined>(
    noSubscribe,
    () => (docked ? document.querySelector(TOOL_COLUMN_SELECTOR) : null),
    () => undefined,
  );

  const dock = React.useMemo<PanelDock>(
    () => ({
      onClose: () => onOpenChange(false),
      backLabel,
      titleId,
      descriptionId,
    }),
    [onOpenChange, backLabel, titleId, descriptionId],
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
/**
 * The control last pressed, and when. Safari doesn't focus a clicked button,
 * so at the moment a docked panel opens `activeElement` is `<body>` (or
 * wherever focus was before), not the button that opened it; this is how the
 * panel still finds its opener to hand focus back to.
 *
 * A press on a menu item records the menu's trigger instead (Radix names the
 * menu by it, `aria-labelledby`): the item is gone once the menu closes, so
 * the button that opened the menu is where focus goes back, as it would after
 * any other choice from that menu. Enter and Space on a focused item count as
 * a press too, since a keyboard choice also unmounts it.
 */
let lastPressed: { control: HTMLElement; at: number } | null = null;
let pressListeners = 0;
function recordPress(target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  let control = target.closest<HTMLElement>(
    'button, a[href], [role="button"], [role="menuitem"]',
  );
  const menu = control?.closest('[role="menu"]');
  const triggerId = menu?.getAttribute("aria-labelledby");
  if (triggerId) control = document.getElementById(triggerId) ?? control;
  lastPressed = control ? { control, at: Date.now() } : null;
}
function onPress(event: PointerEvent) {
  recordPress(event.target);
}
function onKeyPress(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!(event.target instanceof Element)) return;
  // Only a menu item: a focused button already is `activeElement`.
  if (!event.target.closest('[role="menu"]')) return;
  recordPress(event.target);
}
/** Records presses while a docked `Panel` is on the page. */
function useOpenerTracking(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    if (pressListeners++ === 0) {
      document.addEventListener("pointerdown", onPress, true);
      document.addEventListener("keydown", onKeyPress, true);
    }
    return () => {
      if (--pressListeners === 0) {
        document.removeEventListener("pointerdown", onPress, true);
        document.removeEventListener("keydown", onKeyPress, true);
        lastPressed = null;
      }
    };
  }, [enabled]);
}
/** How recent a press must be to count as what opened the panel. */
const OPENER_WINDOW_MS = 1000;

function openerOf(box: HTMLElement): HTMLElement | null {
  const pressed = lastPressed;
  if (
    pressed &&
    Date.now() - pressed.at < OPENER_WINDOW_MS &&
    pressed.control.isConnected &&
    !box.contains(pressed.control)
  ) {
    return pressed.control;
  }
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null;
}

function DockedPanel({
  dock,
  className,
  onCloseAutoFocus,
  children,
}: {
  dock: PanelDock;
  className?: string;
  /**
   * The sheet's close-focus hook, honoured docked too: a caller that sends
   * focus somewhere else on close (the subscription gate's notice, when a
   * block closed the form) calls `preventDefault()` and focuses it itself.
   */
  onCloseAutoFocus?: (event: Event) => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const closeFocus = React.useRef(onCloseAutoFocus);
  React.useEffect(() => {
    closeFocus.current = onCloseAutoFocus;
  }, [onCloseAutoFocus]);
  const descriptionId = dock.descriptionId;
  React.useEffect(() => {
    const box = ref.current;
    const column = box?.parentElement;
    if (!box || !column) return;
    // What opened the panel gets focus back when it closes: the button
    // pressed for it, or, from the keyboard, the element that had focus.
    const returnTo = openerOf(box);
    const covered = Array.from(column.children).filter(
      (child): child is HTMLElement =>
        child !== box && child instanceof HTMLElement && !child.inert,
    );
    for (const child of covered) child.inert = true;
    // A `PanelDescription` is the panel's description, as a sheet's is its
    // dialog's, so a screen reader reads it with the title when focus lands.
    // Set before the focus, and only when one is drawn, so the id never
    // points at nothing.
    if (box.querySelector(`[id="${descriptionId}"]`)) {
      box.setAttribute("aria-describedby", descriptionId);
    }
    box.focus({ preventScroll: true });

    // Focus that was in the panel and fell to `<body>` comes back to it. A
    // sheet's focus trap did this for free, and a docked panel has none: the
    // focused row a revoke removes, or a dialog opened from the panel with no
    // trigger of its own (Edit name and graduation year), would otherwise
    // leave focus nowhere, and Escape, which the panel hears only from
    // inside, would stop going back. Focus the member moved elsewhere (a
    // click or Tab into chat) is theirs, and stays where they put it.
    let ours = true;
    const overlay = '[role="dialog"], [role="alertdialog"], [role="menu"]';
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Into an overlay opened from the panel, it is still the panel's turn.
      ours = box.contains(target) || (ours && !!target.closest(overlay));
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (box.contains(target)) ours = true;
      else if (!target.closest(overlay)) ours = false;
    };
    const recover = () => {
      if (!ours) return;
      const active = document.activeElement;
      if (active === null || active === document.body) {
        box.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(recover);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown, true);
      for (const child of covered) child.inert = false;
      // Closed while the member was working elsewhere (an upload finishing
      // while they type in chat): focus is theirs, so leave it there.
      if (!ours) return;
      const event = new Event("focus.closeAutoFocus", { cancelable: true });
      closeFocus.current?.(event);
      if (event.defaultPrevented) return;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [descriptionId]);

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

/**
 * A docked panel's body and footer keep to the panel's width, centred, on a
 * page wider than it (chat closed, the tool column the whole window): a
 * profile or a form stretched to 1200px reads as a table, not a record. The
 * inset grows rather than a `max-w` box, so the body's scrollbar stays at the
 * column's edge. Beside chat the column is narrower than this and it is the
 * plain 20px inset.
 */
// 576px is `PANEL_WIDTH_CLASS`'s width. Tailwind needs each as a literal, so
// a change to one is a change to both.
const DOCKED_INSET_CLASS = "px-[max(1.25rem,calc((100%_-_576px)/2_+_1.25rem))]";

/**
 * Marks content that answers Escape itself, such as a task card in edit
 * (#4512): Escape pressed inside it is its own, so the panel stays open.
 * Radix hears Escape on the document before any React handler, so the
 * content could not stop it otherwise, and the panel would close and drop
 * what was being edited.
 */
export const OWNS_ESCAPE = "data-owns-escape";

export const PanelContent = React.forwardRef<
  React.ElementRef<typeof SheetContent>,
  Omit<React.ComponentPropsWithoutRef<typeof SheetContent>, "side">
>(({ className, onEscapeKeyDown, ...props }, ref) => {
  const dock = React.useContext(PanelDockContext);
  if (dock) {
    return (
      <DockedPanel
        dock={dock}
        className={className}
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
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
      onEscapeKeyDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(`[${OWNS_ESCAPE}]`)) {
          event.preventDefault();
        }
        onEscapeKeyDown?.(event);
      }}
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
  /**
   * The title. Leave it out when the body heads the record itself with
   * `PanelTitle` (the member panel's name under the photo): the row then
   * carries only the way back or the close, and `actions`.
   */
  children?: React.ReactNode;
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
        {children ? (
          <h2
            id={dock.titleId}
            className={cn(
              "min-w-0 flex-1 truncate text-body font-semibold",
              className,
            )}
          >
            {children}
          </h2>
        ) : (
          <div className="flex-1" />
        )}
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
      {children ? (
        <SheetTitle className="min-w-0 flex-1 break-words text-lg font-bold leading-[26px]">
          {children}
        </SheetTitle>
      ) : (
        <div className="flex-1" />
      )}
      {actions ? (
        <div className="flex h-[26px] shrink-0 items-center self-start">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A title drawn in the body rather than the header row (the member panel's
 * name under the photo). It names the panel either way: the sheet's dialog
 * title, or the heading a docked panel's region is labelled by. Use it only
 * with a `PanelHeader` that has no title of its own.
 */
export function PanelTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const dock = React.useContext(PanelDockContext);
  if (dock) {
    return (
      <h2 id={dock.titleId} className={className}>
        {children}
      </h2>
    );
  }
  return <SheetTitle className={className}>{children}</SheetTitle>;
}

/**
 * A line under the title that says what the panel is for. As a sheet it is
 * the dialog's description; docked there is no dialog, so it is a plain
 * paragraph in the same style, which the docked panel names as its own
 * description.
 */
export function PanelDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const dock = React.useContext(PanelDockContext);
  if (dock) {
    return (
      <p
        id={dock.descriptionId}
        className={cn("text-sm text-muted-foreground", className)}
      >
        {children}
      </p>
    );
  }
  return <SheetDescription className={className}>{children}</SheetDescription>;
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
  const docked = React.useContext(PanelDockContext) !== null;
  return (
    <Component
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-1",
        docked && DOCKED_INSET_CLASS,
        className,
      )}
      {...props}
    />
  );
}

/**
 * The footer: the panel's primary action, right-aligned, outside the scroll so
 * it never scrolls away. A hairline separates it from a body that scrolls
 * under it.
 *
 * Not `SheetFooter`, which stacks `flex-col-reverse` below `sm` and puts the
 * primary action on top: one row at every width.
 */
export function PanelFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const docked = React.useContext(PanelDockContext) !== null;
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4",
        docked && DOCKED_INSET_CLASS,
        className,
      )}
      {...props}
    />
  );
}
