"use client";

import { useMessageAttachments } from "@repo/hooks";
import { formatBytes } from "@repo/formatting";
import { AttachGlyph } from "./chat-glyphs";
import {
  PREVIEW_ATTRIBUTE,
  useOpenImageViewer,
  viewerImages,
} from "./image-viewer";
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
 */
export function MessageAttachments({
  channelId,
  messageId,
  count,
}: MessageAttachmentsProps) {
  const query = useMessageAttachments(channelId, messageId, count > 0);
  const openViewer = useOpenImageViewer();

  if (count === 0) return null;

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

  const rowClass = cn(
    "flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2 py-1.5",
    "text-caption hover:bg-accent-subtle hover:text-accent-text",
    FOCUS_RING,
  );

  const preview = (attachment: (typeof query.data)[number]) => (
    /* A plain <img>, not next/image. The src is a per-request signed Storage
       URL on a host the Next image loader is not configured for, and routing
       it through /_next/image would strip the query string the signature
       lives in. The alt is the filename so an image that fails to load still
       says what it was. */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attachment.download_url}
      alt={attachment.filename}
      className="max-h-64 max-w-full rounded"
    />
  );

  return (
    // `items-start`: each row sizes to its content, as it did in the bubble's
    // column, rather than stretching to the full thread width.
    <ul className="mt-1 flex flex-col items-start gap-1.5">
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
                className={cn(rowClass, "cursor-zoom-in")}
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
                className={rowClass}
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
