"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useMessageAttachments } from "@repo/hooks";
import { isViewableImage } from "@repo/chat-core/attachments";
import { Download } from "lucide-react";
import {
  MediaViewer,
  VIEWER_CONTROL,
  VIEWER_CONTROL_SIZE,
} from "@/components/shared/media-viewer";
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
 * A message's images, full screen (#2874), in the shared `MediaViewer` the
 * documents page also opens files in (#3849). Clicking an inline preview opens
 * it; the image takes its own size, shrunk to fit the window and never
 * enlarged past it, with no card or caption around it. Mobile's counterpart is
 * `apps/mobile/components/chat/image-viewer.tsx`.
 *
 * The filename is the dialog's accessible name and the image's alt text, never
 * drawn: a filename is whatever the sender's device called the file.
 *
 * It draws the signed URL in an `<img>`, which never runs a response as a
 * document, so it keeps the trust rule the forced download exists for
 * (`spec/behavior/chat/README.md` § File and image uploads). Its download
 * action is the same `<a download>` a file row is: the URL still carries
 * `Content-Disposition: attachment`, so navigating to it saves the file.
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
    viewer.show(images[(index + delta + total) % total]!.id);
  }

  return (
    <MediaViewer
      open={image !== undefined}
      onClose={close}
      label={image?.filename ?? ""}
      description={total > 1 ? "" : "Image attachment."}
      step={
        index === null ? undefined : { index, total, onStep: step, noun: "image" }
      }
      // Back to the preview of the image it was showing, which may not be the
      // one that opened it. Looked up now rather than held, because the row
      // may have been virtualized away and drawn again since; if it isn't on
      // the page, Radix's default applies.
      onCloseAutoFocus={(event) => {
        if (!image) return;
        const preview = Array.from(
          document.querySelectorAll<HTMLElement>(`[${PREVIEW_ATTRIBUTE}]`),
        ).find((node) => node.getAttribute(PREVIEW_ATTRIBUTE) === image.id);
        if (!preview) return;
        event.preventDefault();
        preview.focus();
      }}
      actions={
        image ? (
          <a
            href={image.url}
            target="_blank"
            rel="noreferrer"
            // UX only, like the file row's: the forced download is the URL's
            // own `Content-Disposition`.
            download={image.filename}
            aria-label="Download"
            title="Download"
            className={cn(VIEWER_CONTROL, VIEWER_CONTROL_SIZE)}
          >
            <Download aria-hidden="true" className="size-[18px]" />
          </a>
        ) : null
      }
    >
      {image ? (
        /* A plain <img>, for the reason the inline preview is one: the signed
           URL's query string is the signature, and the Next image loader would
           strip it. Its natural size, capped by the padded window: a small
           image stays sharp rather than blown up. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={image.url}
          alt={image.filename}
          className="max-h-full max-w-full rounded-sm object-contain"
        />
      ) : null}
    </MediaViewer>
  );
}
