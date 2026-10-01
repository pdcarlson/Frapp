"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import { useMessageAttachments } from "@repo/hooks";
import { isViewableImage } from "@repo/chat-core/attachments";
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
    <Dialog
      open={image !== undefined}
      onOpenChange={(open) => {
        if (!open) viewer.close();
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
          // Back to the preview of the image it was showing, which may not be
          // the one that opened it. Looked up now rather than held, because
          // the row may have been virtualized away and drawn again since; if
          // it isn't on the page, Radix's default applies.
          onCloseAutoFocus={(event) => {
            const preview = Array.from(
              document.querySelectorAll<HTMLElement>(`[${PREVIEW_ATTRIBUTE}]`),
            ).find((node) => node.getAttribute(PREVIEW_ATTRIBUTE) === image.id);
            if (!preview) return;
            event.preventDefault();
            preview.focus();
          }}
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
                <span className="shrink-0 text-caption text-muted-foreground">
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
