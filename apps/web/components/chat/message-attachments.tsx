"use client";

import { useState, type CSSProperties } from "react";
import { useMessageAttachments, type MessageAttachment } from "@repo/hooks";
import type { AttachmentPhoto } from "@repo/chat-core/types";
import { formatBytes } from "@repo/formatting";
import { AttachGlyph } from "./chat-glyphs";
import {
  PREVIEW_ATTRIBUTE,
  useOpenImageViewer,
  viewerImages,
} from "./image-viewer";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { thumbhashPlaceholderUrl } from "@/lib/chat/photo-preview";

interface MessageAttachmentsProps {
  channelId: string;
  messageId: string;
  /** `message.attachment_count` — 0 means nothing is fetched. */
  count: number;
  /**
   * False while the message is still the sender's local copy (any `_status`
   * but `confirmed`). That row's id is its `client_message_id`, and the server
   * mints its own id, so there is no message to read the files from yet:
   * asking answers 404 every time (#4095, FRAPP-WEB-8). Nothing is fetched,
   * and the row names how many files it carries; its own chrome says whether
   * it is sending or failed. The confirmed row that replaces it carries the
   * server id and fetches then. Mobile gates the same way
   * (`apps/mobile/components/chat/message-attachments.tsx`).
   */
  confirmed?: boolean;
  /**
   * `message.attachment_photos`: each photo's size and blur, stamped on the
   * message at send (#3879). With it, the pending state draws every photo's
   * box at its final size and every file as a chip, so the row is as tall
   * before the attachments read returns as after, and the rows above it don't
   * shift. Without it (a message sent before the stamp, or an import), the
   * pending state is the one-line "Loading attachment…" it always was.
   */
  photos?: readonly AttachmentPhoto[];
}

/**
 * Files attached to a message.
 *
 * Fetched rather than read off the message, because a download URL has to be
 * signed per request — every bucket in this repo is private. `count` comes from
 * the message row, so a message with no attachments never issues a request.
 *
 * The loading and error states are deliberately visible. This replaced a
 * rendering where the filename was literal text in the message body, which was
 * broken but never *blank* — degrading to nothing here would read as data loss
 * to anyone who remembers seeing the file.
 *
 * An image (`isViewableImage`, through `viewerImages`) previews inline and opens the in-app viewer,
 * which steps through the message's other images and carries the download
 * (#2874). The timeline hosts the viewer, above its virtualized rows
 * (`useImageViewer`); where nothing hosts one, an image is a download link
 * like any other file. Every other file, SVG included, is a row that
 * downloads.
 *
 * **Callers must not mount this for a message with no attachments.** The query
 * hook reaches for `FrappClientProvider` the moment this renders, so mounting it
 * unconditionally would make every plain text row — the overwhelming majority —
 * require a client context it has never needed. `MessageItem` guards on
 * `attachment_count` for that reason; the check below is belt and braces.
 *
 * **A photo loads small, behind a blur** (2026-11-07). One sent since then
 * carries its size, a ThumbHash and a 1280 px preview copy
 * (`lib/chat/photo-preview.ts`): the hash fills the picture's box with a soft
 * blur of its colours, and the preview, a fraction of the original's bytes,
 * paints over it. The viewer and the download keep the original. An older
 * photo has none of the three and draws as before.
 *
 * **The box is there before the read returns** (#3879). The size and hash
 * live on the attachment rows, which arrive with the read; a message sent
 * since #3879 also carries them in its own metadata (`photos`), so the
 * pending state already draws each photo's box at its final size. An older
 * message's row still grows once when its read lands; the timeline keeps the
 * newest message in view through that (`useStickToBottom`, #3863).
 */
export function MessageAttachments({
  channelId,
  messageId,
  count,
  confirmed = true,
  photos,
}: MessageAttachmentsProps) {
  const query = useMessageAttachments(
    channelId,
    messageId,
    count > 0 && confirmed,
  );
  const openViewer = useOpenImageViewer();

  if (count === 0) return null;

  if (!confirmed) {
    return (
      <p className="mt-1 text-caption text-muted-foreground">
        {count === 1 ? "1 attachment" : `${count} attachments`}
      </p>
    );
  }

  if (query.isPending && photos && photos.length <= count) {
    return (
      <PendingAttachments
        photos={photos}
        files={count - photos.length}
        label={
          count === 1 ? "Loading attachment…" : `Loading ${count} attachments…`
        }
      />
    );
  }

  if (query.isPending) {
    return (
      <p className="mt-1 text-caption text-muted-foreground">
        {count === 1 ? "Loading attachment…" : `Loading ${count} attachments…`}
      </p>
    );
  }

  if (query.isError || !query.data) {
    return (
      <p className="mt-1 text-caption text-destructive">
        {count === 1 ? "Attachment" : `${count} attachments`} couldn&apos;t be
        loaded.
      </p>
    );
  }

  const imageIds = new Set(viewerImages(query.data).map((image) => image.id));

  // A file is a row: a framed chip with its glyph, name and size. A photo is
  // not a file chip. It draws bare, at its own shape with the media radius,
  // so the thread shows the picture rather than a box holding one
  // (components.md § Chrome weight). The transparent border is the focus
  // recipe's: FOCUS_RING swaps a border, so a control needs one to swap.
  const rowClass = cn(
    FILE_ROW_CLASS,
    "hover:bg-card-hover hover:text-foreground",
    FOCUS_RING,
  );
  const imageClass = cn(PHOTO_FRAME_CLASS, FOCUS_RING);

  const preview = (attachment: MessageAttachment) => (
    <AttachmentImage attachment={attachment} />
  );

  return (
    // `items-start`: each row sizes to its content, as it did in the bubble's
    // column, rather than stretching to the full thread width.
    <ul className={LIST_CLASS}>
      {query.data.map((attachment) => {
        const isImage = imageIds.has(attachment.id);
        return (
          <li key={attachment.id}>
            {isImage && openViewer ? (
              <button
                type="button"
                {...{ [PREVIEW_ATTRIBUTE]: attachment.id }}
                aria-label={`View ${attachment.filename}`}
                aria-haspopup="dialog"
                onClick={() =>
                  openViewer({ channelId, messageId, imageId: attachment.id })
                }
                className={cn(imageClass, "cursor-zoom-in")}
              >
                {preview(attachment)}
              </button>
            ) : (
              <a
                href={attachment.download_url}
                target="_blank"
                rel="noreferrer"
                // The server still forces `Content-Disposition: attachment`
                // on every signed URL (`ChatAttachmentService.listMessageAttachments`
                // passes `forceDownload: true` — spec/behavior/chat/README.md's
                // "trust boundary" section is explicit this is a security
                // mitigation, not a UX one: it's what keeps a member-uploaded
                // object whose declared MIME lied about its content from
                // rendering as HTML). That disposition header already carries
                // a filename of its own (the storage object's basename, not
                // `row.filename`), so this attribute is a harmless no-op for
                // the actual deployment shape here: a cross-origin Supabase
                // Storage signed URL, for which browsers ignore `download`'s
                // suggested-filename value per the HTML spec — only
                // same-origin / `blob:` / `data:` URLs honour it. Left in case
                // that ever changes; it costs nothing today.
                download={attachment.filename}
                className={isImage ? imageClass : rowClass}
              >
                {isImage ? (
                  preview(attachment)
                ) : (
                  <>
                    <AttachGlyph
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{attachment.filename}</span>
                    {attachment.byte_size != null ? (
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(attachment.byte_size)}
                      </span>
                    ) : null}
                  </>
                )}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A file chip's frame; the pending chip shares it, so it is as tall. */
const FILE_ROW_CLASS =
  "flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2 py-1.5 text-caption";

/**
 * A photo's frame. The transparent border is the focus recipe's: FOCUS_RING
 * swaps a border, so a control needs one to swap. The pending box keeps it so
 * it is as tall as the control it becomes.
 */
const PHOTO_FRAME_CLASS =
  "block overflow-hidden rounded-md border border-transparent";

/** The list the files sit in, loaded or pending. */
const LIST_CLASS = "mt-1 flex flex-col items-start gap-1.5";

/** A 1x1 transparent GIF: the pending photo box's source, under its blur. */
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** The tallest a photo draws in the thread, `max-h-64`. */
const PHOTO_MAX_HEIGHT = 256;

/** A photo's stored size, when it gives the shape; a lone edge doesn't. */
function storedSize(
  width: number | null | undefined,
  height: number | null | undefined,
): { width: number; height: number } | null {
  return width != null && height != null && width > 0 && height > 0
    ? { width, height }
    : null;
}

/**
 * A sized photo's box: as wide as the photo at the 256px height cap, never
 * wider than the column (`max-w-full`), its height from the aspect ratio.
 */
function photoBoxStyle({
  width,
  height,
}: {
  width: number;
  height: number;
}): CSSProperties {
  return {
    aspectRatio: `${width} / ${height}`,
    width: `${Math.min(width, (PHOTO_MAX_HEIGHT * width) / height)}px`,
  };
}

/** The ThumbHash blur behind a photo until it paints. */
function blurStyle(placeholder: string | null): CSSProperties {
  return placeholder
    ? { backgroundImage: `url("${placeholder}")`, backgroundSize: "100% 100%" }
    : {};
}

/**
 * The attachments before their read returns, when the message carries its
 * photos' geometry (#3879): each sized photo's box with its blur, at the size
 * and in the frame the loaded photo takes, and each file a chip of a loaded
 * chip's height. The column is as tall as the loaded one in any order, so the
 * read's order need not match the stamp's. An unsized photo (one the sender's
 * device could not measure) can't be reserved and draws a caption line, as
 * every photo did before.
 */
function PendingAttachments({
  photos,
  files,
  label,
}: {
  photos: readonly AttachmentPhoto[];
  files: number;
  label: string;
}) {
  return (
    <ul
      className={LIST_CLASS}
      aria-busy="true"
      aria-label={label}
      data-testid="attachments-pending"
    >
      {photos.map((photo, index) => {
        const size = storedSize(photo.width, photo.height);
        return size ? (
          <li key={`photo-${index}`}>
            <span className={PHOTO_FRAME_CLASS}>
              {/* An <img>, not a box: a percentage max-width shrinks a
                  replaced element in this shrink-to-fit column but not a
                  span, so only an image sizes like the photo it becomes when
                  the photo is wider than the column (measured in Chromium:
                  a span stayed 258px tall where the photo drew 136px). Its
                  source is a transparent pixel; the blur is its background,
                  as on the loaded photo. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-testid="attachment-photo-box"
                src={TRANSPARENT_PIXEL}
                alt=""
                width={size.width}
                height={size.height}
                // With no blur, the skeleton's neutral fill marks the box.
                className={cn(
                  "block h-auto max-h-64 max-w-full",
                  !photo.thumbhash && "bg-surface-1",
                )}
                style={{
                  ...photoBoxStyle(size),
                  ...blurStyle(thumbhashPlaceholderUrl(photo.thumbhash)),
                }}
              />
            </span>
          </li>
        ) : (
          <li
            key={`photo-${index}`}
            className="text-caption text-muted-foreground"
          >
            Loading photo…
          </li>
        );
      })}
      {Array.from({ length: files }, (_, index) => (
        <li key={`file-${index}`}>
          <span
            data-testid="attachment-file-chip"
            className={cn(FILE_ROW_CLASS, "text-muted-foreground")}
          >
            <AttachGlyph className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Loading file…</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One photo in the thread: the preview copy when there is one, the original
 * when there is not or the preview fails, sized from the stored dimensions and
 * filled with its ThumbHash blur until it paints.
 */
function AttachmentImage({ attachment }: { attachment: MessageAttachment }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src =
    !previewFailed && attachment.preview_url
      ? attachment.preview_url
      : attachment.download_url;
  const placeholder = loaded
    ? null
    : thumbhashPlaceholderUrl(attachment.thumbhash);
  const size = storedSize(attachment.width, attachment.height);
  return (
    /* A plain <img>, not next/image. The src is a per-request signed Storage
       URL on a host the Next image loader is not configured for, and routing
       it through /_next/image would strip the query string the signature
       lives in. The alt is the filename so an image that fails to load still
       says what it was. */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={attachment.filename}
      // With stored dimensions the box is the photo's shape before a byte
      // arrives: as wide as the photo at the 256px height cap, never wider
      // than the column, its height from the aspect ratio.
      width={size?.width}
      height={size?.height}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (src !== attachment.download_url) setPreviewFailed(true);
      }}
      className={cn("block max-h-64 max-w-full", size && "h-auto")}
      style={{
        ...(size ? photoBoxStyle(size) : {}),
        ...blurStyle(placeholder),
      }}
    />
  );
}
