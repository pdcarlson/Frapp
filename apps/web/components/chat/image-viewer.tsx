"use client";

import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ViewerImage {
  id: string;
  filename: string;
  /** The attachment's signed URL, which forces a download when navigated to. */
  url: string;
}

interface ImageViewerProps {
  /** The message's images, in order. */
  images: readonly ViewerImage[];
  /** Which one is showing, or `null` when the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /**
   * Where focus goes when the viewer closes: the preview of the image it was
   * showing, which may not be the one that opened it.
   */
  onCloseAutoFocus: (event: Event, index: number) => void;
}

/**
 * A message's images, large, in a dialog (#2874). Clicking an inline preview
 * opens it; Esc, a click on the backdrop and the close button dismiss it, and
 * the arrow keys step through the message's other images, wrapping at the
 * ends. Mobile's counterpart is `apps/mobile/components/chat/image-viewer.tsx`.
 *
 * It draws the signed URL in an `<img>`, which never runs a response as a
 * document, so it keeps the trust rule the forced download exists for
 * (`spec/behavior/chat/README.md` § File and image uploads). Its download
 * action is the same `<a download>` a file row is: the URL still carries
 * `Content-Disposition: attachment`, so navigating to it saves the file.
 *
 * Built on the shared `Dialog` (Radix), which brings the focus trap, Esc,
 * the backdrop dismissal and `aria-modal`.
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
  onCloseAutoFocus,
}: ImageViewerProps) {
  const image = index === null ? undefined : images[index];
  const total = images.length;

  // Stepping wraps. A step control disabled at either end would drop focus to
  // the page the moment it took the step that disabled it, and with it the
  // arrow keys, which only work while focus is inside the dialog.
  function step(delta: -1 | 1) {
    if (index === null || total < 2) return;
    onIndexChange((index + delta + total) % total);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  }

  return (
    <Dialog
      open={image !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {image ? (
        <DialogContent
          // Sized to the image rather than the dialog's form width, so a
          // small image isn't lost in a wide card and a large one fills the
          // viewport. `w-max` (not `w-auto`): a fixed box at `left: 50%`
          // would otherwise shrink-wrap to the half of the viewport to its
          // right.
          className="w-max max-w-[calc(100vw-2rem)] gap-3 p-3 focus:outline-none"
          onKeyDown={handleKeyDown}
          // Focus the dialog itself, not its first control: a screen reader
          // then reads the image's name and how to step, and a mouse user's
          // click doesn't land a focus ring on "Previous image". The arrow
          // keys work from here, since the dialog is where they're heard. It
          // is not a control, so it draws no outline of its own
          // (`focus:outline-none` above).
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(event) => onCloseAutoFocus(event, index!)}
        >
          {/* `pr-10` keeps the row clear of the dialog's own close button. */}
          <div className="flex min-w-0 items-center gap-2 pr-10">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">
              {image.filename}
            </DialogTitle>
            {total > 1 ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Previous image"
                  onClick={() => step(-1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="shrink-0 text-[12.5px] text-muted-foreground">
                  {index! + 1} of {total}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Next image"
                  onClick={() => step(1)}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <a
                href={image.url}
                target="_blank"
                rel="noreferrer"
                // UX only, like the file row's: the forced download is the
                // URL's own `Content-Disposition`.
                download={image.filename}
              >
                <Download aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Download</span>
              </a>
            </Button>
          </div>
          <DialogDescription className="sr-only">
            {total > 1
              ? `Image ${index! + 1} of ${total}. The left and right arrow keys show the others.`
              : "Image attachment."}
          </DialogDescription>
          {/* A plain <img>, for the reason the inline preview is one: the
              signed URL's query string is the signature, and the Next image
              loader would strip it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.filename}
            className="mx-auto max-h-[calc(100vh-8rem)] max-w-full rounded-md object-contain"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
