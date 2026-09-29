"use client";

import { useRef, useState } from "react";
import { useMessageAttachments } from "@repo/hooks";
import { formatBytes } from "@repo/formatting";
import { isViewableImage } from "@repo/chat-core/attachments";
import { AttachGlyph } from "./chat-glyphs";
import { ImageViewer, type ViewerImage } from "./image-viewer";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

interface MessageAttachmentsProps {
  channelId: string;
  messageId: string;
  /** `message.attachment_count` — 0 means nothing is fetched. */
  count: number;
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
 * An image (`isViewableImage`) previews inline and opens the in-app viewer,
 * which steps through the message's other images and carries the download
 * (#2874). Every other file, SVG included, is a row that downloads.
 *
 * **Callers must not mount this for a message with no attachments.** The query
 * hook reaches for `FrappClientProvider` the moment this renders, so mounting it
 * unconditionally would make every plain text row — the overwhelming majority —
 * require a client context it has never needed. `MessageItem` guards on
 * `attachment_count` for that reason; the check below is belt and braces.
 */
export function MessageAttachments({
  channelId,
  messageId,
  count,
}: MessageAttachmentsProps) {
  const query = useMessageAttachments(channelId, messageId, count > 0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Each preview, so closing the viewer returns focus to the image it was
  // showing rather than to the one that opened it.
  const previews = useRef(new Map<string, HTMLButtonElement>());

  if (count === 0) return null;

  if (query.isPending) {
    return (
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {count === 1 ? "Loading attachment…" : `Loading ${count} attachments…`}
      </p>
    );
  }

  if (query.isError || !query.data) {
    return (
      <p className="mt-1 text-[12.5px] text-destructive">
        {count === 1 ? "Attachment" : `${count} attachments`} couldn&apos;t be
        loaded.
      </p>
    );
  }

  const images: ViewerImage[] = query.data
    .filter((attachment) => isViewableImage(attachment.content_type))
    .map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      url: attachment.download_url,
    }));

  const rowClass = cn(
    "flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2 py-1.5",
    "text-[12.5px] hover:bg-accent-subtle hover:text-accent-text",
    FOCUS_RING,
  );

  return (
    <>
      <ul className="mt-1 flex flex-col gap-1.5">
        {query.data.map((attachment) => {
          const imageIndex = images.findIndex(
            (image) => image.id === attachment.id,
          );
          return (
            <li key={attachment.id}>
              {imageIndex !== -1 ? (
                <button
                  type="button"
                  ref={(node) => {
                    if (node) previews.current.set(attachment.id, node);
                    else previews.current.delete(attachment.id);
                  }}
                  aria-label={`View ${attachment.filename}`}
                  aria-haspopup="dialog"
                  onClick={() => setViewerIndex(imageIndex)}
                  className={cn(rowClass, "cursor-zoom-in")}
                >
                  {/* A plain <img>, not next/image. The src is a per-request
                      signed Storage URL on a host the Next image loader is not
                      configured for, and routing it through /_next/image would
                      strip the query string the signature lives in. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachment.download_url}
                    // The button's label names it.
                    alt=""
                    className="max-h-64 max-w-full rounded"
                  />
                </button>
              ) : (
                <a
                  href={attachment.download_url}
                  target="_blank"
                  rel="noreferrer"
                  // The server still forces `Content-Disposition: attachment`
                  // on every signed URL (`ChatService.listMessageAttachments`
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
                  className={rowClass}
                >
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
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <ImageViewer
        images={images}
        // A refetch can drop the image that was showing (the message was
        // deleted, or the list came back shorter), so an index past the end
        // closes the viewer rather than showing nothing.
        index={
          viewerIndex !== null && viewerIndex < images.length
            ? viewerIndex
            : null
        }
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
        onCloseAutoFocus={(event, index) => {
          const preview = previews.current.get(images[index]?.id ?? "");
          if (!preview) return;
          event.preventDefault();
          preview.focus();
        }}
      />
    </>
  );
}
