"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * An icon control on the viewer's backdrop. White at 70%, full white on hover:
 * the backdrop is black in both themes, so the theme's text roles (and the
 * chapter accent) don't apply here, and nothing in the corner should draw the
 * eye before the content does. Compact under a mouse, and 44px under a finger
 * (`VIEWER_CONTROL_SIZE`), the touch floor foundations.md §9 sets for web too.
 */
export const VIEWER_CONTROL = cn(
  "inline-flex items-center justify-center rounded-md border border-transparent text-white/70 transition-colors hover:bg-white/10 hover:text-white",
  FOCUS_RING,
);

/** The corner controls' size: 36px under a mouse, 44px under a finger. */
export const VIEWER_CONTROL_SIZE = "size-9 pointer-coarse:size-11";

/**
 * Marks an element inside the viewer that a press closes it from, as a press
 * on the backdrop itself does: a scrolling column of pages fills the window,
 * so the space beside the pages is that column, not the backdrop.
 */
export const VIEWER_BACKDROP_ATTRIBUTE = "data-viewer-backdrop";

export interface MediaViewerStep {
  /** Zero-based position of what's shown, among `total`. */
  index: number;
  total: number;
  onStep: (delta: -1 | 1) => void;
  /** "image" or "file", for the step buttons' names and the description. */
  noun: string;
}

/**
 * The full-screen viewer chat's images (#2874) and chapter documents (#3849)
 * open in. Content shows over a dim backdrop that covers the whole window,
 * with no card around it. Esc, a press on the backdrop and the close button
 * dismiss it, and when there is more than one item the arrow keys and the side
 * arrows step through them, wrapping at the ends.
 *
 * Its controls are icons only, grouped in the top-right corner (the caller's
 * `actions`, then close), with step arrows at the sides: the content is the
 * point, and nothing around it should compete with it (Paul, 2026-11-05).
 * `heading` is drawn top-left when the caller has a real name to show; chat
 * passes none, since a filename is whatever the sender's device called it.
 *
 * Built on Radix's Dialog primitives directly rather than the shared
 * `DialogContent`, whose bordered card and corner close button are exactly
 * what this must not draw. Radix still brings the focus trap, Esc and the
 * outside-pointer block; `aria-modal` is set here, as the shared one sets it.
 *
 * What it shows is the caller's: chat draws an `<img>`, documents draw PDF
 * pages to a canvas. Neither ever loads a member's file as a document, which
 * is the trust rule `spec/behavior/chat/README.md` § File and image uploads
 * states.
 */
export function MediaViewer({
  open,
  onClose,
  label,
  description,
  heading,
  actions,
  step,
  onCloseAutoFocus,
  contentClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name. */
  label: string;
  /**
   * Read after the name. With more than one item, "Image 2 of 5" and the
   * arrow-key hint follow it, so a caller may pass "" there.
   */
  description: string;
  heading?: ReactNode;
  actions?: ReactNode;
  step?: MediaViewerStep;
  /** Radix's close-focus hook, for returning focus to what opened it. */
  onCloseAutoFocus?: (event: Event) => void;
  /** Classes for the content area, which centres its child by default. */
  contentClassName?: string;
  children: ReactNode;
}) {
  // Whether the current press started on the backdrop (see `onPointerUp`).
  const pressedBackdrop = useRef(false);
  const many = step !== undefined && step.total > 1;

  function isBackdrop(event: { target: EventTarget; currentTarget: EventTarget }) {
    return (
      event.target === event.currentTarget ||
      (event.target instanceof HTMLElement &&
        event.target.hasAttribute(VIEWER_BACKDROP_ATTRIBUTE))
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!many) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step.onStep(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step.onStep(1);
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open ? (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
          <DialogPrimitive.Content
            aria-modal="true"
            // The whole window, so the backdrop is part of the content and
            // Radix's outside-press never fires. A press that both starts and
            // ends on the backdrop (this element, or one marked with
            // `VIEWER_BACKDROP_ATTRIBUTE`) closes it instead. Pointer events,
            // not `click`: a press that starts on a button and slips off it
            // fires `click` on this common ancestor, and iOS Safari may not
            // fire `click` at all on a plain element.
            className={cn(
              "fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none sm:px-16 sm:py-14",
              contentClassName,
            )}
            onPointerDown={(event) => {
              // The primary button only: a right-click there opens the
              // browser's menu and shouldn't also close the viewer.
              pressedBackdrop.current = event.button === 0 && isBackdrop(event);
            }}
            onPointerUp={(event) => {
              const fromBackdrop = pressedBackdrop.current;
              pressedBackdrop.current = false;
              if (fromBackdrop && isBackdrop(event)) onClose();
            }}
            onKeyDown={handleKeyDown}
            // Focus the viewer itself, not its first control: a screen reader
            // then reads the name and how to step, and a mouse user's click
            // doesn't land a focus ring on the download button. The arrow keys
            // work from here, since the viewer is where they're heard. It is
            // not a control, so it draws no outline of its own.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {many
                ? [
                    description,
                    `${capitalize(step.noun)} ${step.index + 1} of ${step.total}. The left and right arrow keys show the others.`,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : description}
            </DialogPrimitive.Description>

            {children}

            {heading ? (
              <div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-8.5rem)] rounded-lg bg-black/55 px-2.5 py-1.5">
                {heading}
              </div>
            ) : null}

            <div className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg bg-black/55 p-1">
              {actions}
              <DialogPrimitive.Close
                aria-label="Close"
                title="Close"
                className={cn(VIEWER_CONTROL, VIEWER_CONTROL_SIZE)}
              >
                <X aria-hidden="true" className="size-5" />
              </DialogPrimitive.Close>
            </div>

            {many ? (
              <>
                <button
                  type="button"
                  aria-label={`Previous ${step.noun}`}
                  title="Previous"
                  onClick={() => step.onStep(-1)}
                  className={cn(
                    VIEWER_CONTROL,
                    "absolute left-3 top-1/2 size-10 -translate-y-1/2 pointer-coarse:size-11 rounded-full bg-black/55",
                  )}
                >
                  <ChevronLeft aria-hidden="true" className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label={`Next ${step.noun}`}
                  title="Next"
                  onClick={() => step.onStep(1)}
                  className={cn(
                    VIEWER_CONTROL,
                    "absolute right-3 top-1/2 size-10 -translate-y-1/2 pointer-coarse:size-11 rounded-full bg-black/55",
                  )}
                >
                  <ChevronRight aria-hidden="true" className="size-5" />
                </button>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-caption tabular-nums text-white/60"
                >
                  {step.index + 1} of {step.total}
                </span>
              </>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
