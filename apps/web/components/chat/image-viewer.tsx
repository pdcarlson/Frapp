"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useMessageAttachments } from "@repo/hooks";
import { isViewableImage } from "@repo/chat-core/attachments";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

export interface ViewerImage {
  id: string;
  filename: string;
  /** The attachment's signed URL, which forces a download when navigated to. */
  url: string;
}

/** The fields of an attachment row the viewer reads. */
interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string | null;
  download_url: string;
}

/** A message's images, in order: the attachments `isViewableImage` accepts. */
export function viewerImages(
  attachments: readonly AttachmentRow[],
): ViewerImage[] {
  return attachments
    .filter((attachment) => isViewableImage(attachment.content_type))
    .map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      url: attachment.download_url,
    }));
}

/** Which message's images the viewer shows, and which one. */
export interface ViewerTarget {
  channelId: string;
  messageId: string;
  imageId: string;
}

export interface ImageViewerState {
  target: ViewerTarget | null;
  open: (target: ViewerTarget) => void;
  close: () => void;
  show: (imageId: string) => void;
}

/**
 * Opens the viewer on one of a message's images. Provided by the timeline;
 * null where no surface hosts a viewer, and there an image is a download
 * link like any other file.
 */
const ImageViewerContext = createContext<ImageViewerState["open"] | null>(null);

export const ImageViewerProvider = ImageViewerContext.Provider;

export function useOpenImageViewer(): ImageViewerState["open"] | null {
  return useContext(ImageViewerContext);
}

/**
 * The viewer's state, for the surface that hosts it.
 *
 * It lives above the timeline's virtualized rows, never in a row: a row
 * unmounts once it scrolls out of the window (a new message arriving is
 * enough), which would take an open dialog with it; and React events bubble
 * through a portal along the component tree, so a dialog inside a row would
 * hand every click on the image to the row's own tap handler.
 *
 * It holds ids, not the images: the viewer reads them through the same
 * attachments query the row does, so a refetch hands it fresh signed URLs
 * (they last an hour) even after the row has gone. The host closes it when
 * the message stops being shown.
 */
export function useImageViewer(): ImageViewerState {
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const close = useCallback(() => setTarget(null), []);
  const show = useCallback(
    (imageId: string) =>
      setTarget((current) => (current ? { ...current, imageId } : current)),
    [],
  );
  return { target, open: setTarget, close, show };
}

/** The attribute each inline preview carries, for focus to find it on close. */
export const PREVIEW_ATTRIBUTE = "data-attachment-preview";

/**
 * A message's images, full screen (#2874). Clicking an inline preview opens
 * it over a dim backdrop that covers the whole window; the image takes its own
 * size, shrunk to fit the window and never enlarged past it, with no card or
 * caption around it. Esc, a press on the backdrop and the close button
 * dismiss it, and the arrow keys step through the message's other images,
 * wrapping at the ends. Mobile's counterpart is
 * `apps/mobile/components/chat/image-viewer.tsx`.
 *
 * Its controls are icons only, grouped in the top-right corner (download,
 * close), with step arrows at the sides when the message has more than one
 * image: the image is the content, and nothing around it should compete with
 * it (Paul, 2026-11-05). The filename is the dialog's accessible name and the
 * image's alt text, never drawn: a filename is whatever the sender's device
 * called the file.
 *
 * It draws the signed URL in an `<img>`, which never runs a response as a
 * document, so it keeps the trust rule the forced download exists for
 * (`spec/behavior/chat/README.md` § File and image uploads). Its download
 * action is the same `<a download>` a file row is: the URL still carries
 * `Content-Disposition: attachment`, so navigating to it saves the file.
 *
 * Built on Radix's Dialog primitives directly rather than the shared
 * `DialogContent`, whose bordered card and corner close button are exactly
 * what this must not draw. Radix still brings the focus trap, Esc and the
 * outside-pointer block; `aria-modal` is set here, as the shared one sets it.
 */
export function ImageViewer({ viewer }: { viewer: ImageViewerState }) {
  // Mounted only while open. The attachments query reaches for the API client
  // context as it renders, so a closed viewer must not, or every timeline
  // would need that context whether or not anyone opens an image.
  if (!viewer.target) return null;
  return <OpenImageViewer target={viewer.target} viewer={viewer} />;
}

function OpenImageViewer({
  target,
  viewer,
}: {
  target: ViewerTarget;
  viewer: ImageViewerState;
}) {
  const { close } = viewer;
  // Whether the current press started on the backdrop (see `onPointerUp`).
  const pressedBackdrop = useRef(false);
  // The row that opened the viewer already holds this query, so opening sends
  // no request (`refetchOnMount: false`: a refetch mints new signed URLs and
  // would swap the image being opened for a fresh download of itself). It
  // still refetches on window focus and reconnect once stale, with the row or
  // alone after the row has scrolled away, which is what keeps its hour-long
  // signed URLs current.
  const query = useMessageAttachments(
    target.channelId,
    target.messageId,
    true,
    {
      refetchOnMount: false,
    },
  );
  const images = query.data ? viewerImages(query.data) : [];
  const found = images.findIndex((image) => image.id === target.imageId);
  const index = found === -1 ? null : found;
  const image = index === null ? undefined : images[index];
  const total = images.length;
  const onIndexChange = (next: number) => viewer.show(images[next]!.id);

  // A refetch that no longer lists the image (the attachment was removed)
  // closes the viewer rather than leaving it open on nothing.
  const lost = query.data !== undefined && found === -1;
  useEffect(() => {
    if (lost) close();
  }, [lost, close]);

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
    <DialogPrimitive.Root
      open={image !== undefined}
      onOpenChange={(open) => {
        if (!open) viewer.close();
      }}
    >
      {image ? (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
          <DialogPrimitive.Content
            aria-modal="true"
            // The whole window, so the backdrop is part of the content and
            // Radix's outside-press never fires. A press that both starts and
            // ends on this element itself (not the image or a control) closes
            // it instead. Pointer events, not `click`: a press that starts on
            // a button and slips off it fires `click` on this common ancestor,
            // and iOS Safari may not fire `click` at all on a plain element.
            className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none sm:px-16 sm:py-14"
            onPointerDown={(event) => {
              pressedBackdrop.current = event.target === event.currentTarget;
            }}
            onPointerUp={(event) => {
              const fromBackdrop = pressedBackdrop.current;
              pressedBackdrop.current = false;
              if (fromBackdrop && event.target === event.currentTarget) {
                viewer.close();
              }
            }}
            onKeyDown={handleKeyDown}
            // Focus the viewer itself, not its first control: a screen reader
            // then reads the image's name and how to step, and a mouse user's
            // click doesn't land a focus ring on the download button. The
            // arrow keys work from here, since the viewer is where they're
            // heard. It is not a control, so it draws no outline of its own
            // (`focus:outline-none` above).
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            // Back to the preview of the image it was showing, which may not be
            // the one that opened it. Looked up now rather than held, because
            // the row may have been virtualized away and drawn again since; if
            // it isn't on the page, Radix's default applies.
            onCloseAutoFocus={(event) => {
              const preview = Array.from(
                document.querySelectorAll<HTMLElement>(
                  `[${PREVIEW_ATTRIBUTE}]`,
                ),
              ).find(
                (node) => node.getAttribute(PREVIEW_ATTRIBUTE) === image.id,
              );
              if (!preview) return;
              event.preventDefault();
              preview.focus();
            }}
          >
            <DialogPrimitive.Title className="sr-only">
              {image.filename}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {total > 1
                ? `Image ${index! + 1} of ${total}. The left and right arrow keys show the others.`
                : "Image attachment."}
            </DialogPrimitive.Description>
            {/* A plain <img>, for the reason the inline preview is one: the
                signed URL's query string is the signature, and the Next image
                loader would strip it. Its natural size, capped by the padded
                window: a small image stays sharp rather than blown up. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={image.filename}
              className="max-h-full max-w-full rounded-sm object-contain"
            />

            <div className="absolute right-3 top-3 flex items-center gap-0.5 rounded-lg bg-black/55 p-1">
              <a
                href={image.url}
                target="_blank"
                rel="noreferrer"
                // UX only, like the file row's: the forced download is the
                // URL's own `Content-Disposition`.
                download={image.filename}
                aria-label="Download"
                title="Download"
                className={cn(VIEWER_CONTROL, "size-9 pointer-coarse:size-11")}
              >
                <Download aria-hidden="true" className="size-[18px]" />
              </a>
              <DialogPrimitive.Close
                aria-label="Close"
                title="Close"
                className={cn(VIEWER_CONTROL, "size-9 pointer-coarse:size-11")}
              >
                <X aria-hidden="true" className="size-5" />
              </DialogPrimitive.Close>
            </div>

            {total > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  title="Previous"
                  onClick={() => step(-1)}
                  className={cn(
                    VIEWER_CONTROL,
                    "absolute left-3 top-1/2 size-10 -translate-y-1/2 pointer-coarse:size-11 rounded-full bg-black/55",
                  )}
                >
                  <ChevronLeft aria-hidden="true" className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  title="Next"
                  onClick={() => step(1)}
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
                  {index! + 1} of {total}
                </span>
              </>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}

/**
 * An icon control on the backdrop. White at 70%, full white on hover: the
 * backdrop is black in both themes, so the theme's text roles (and the
 * chapter accent) don't apply here, and nothing in the corner should draw
 * the eye before the image does. Compact under a mouse, and 44px under a
 * finger (`pointer-coarse:size-11` at each call site), the touch floor
 * foundations.md §9 sets for web too.
 */
const VIEWER_CONTROL = cn(
  "inline-flex items-center justify-center rounded-md border border-transparent text-white/70 transition-colors hover:bg-white/10 hover:text-white",
  FOCUS_RING,
);
