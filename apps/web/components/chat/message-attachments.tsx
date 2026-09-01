"use client";

import { useMessageAttachments } from "@repo/hooks";
import { formatBytes } from "@repo/formatting";
import { AttachGlyph } from "./chat-glyphs";
import { cn } from "@/lib/utils";

interface MessageAttachmentsProps {
  channelId: string;
  messageId: string;
  /** `message.attachment_count` — 0 means nothing is fetched. */
  count: number;
}

/** Content types rendered as an inline preview rather than a download row. */
function isPreviewable(contentType: string | null): boolean {
  return !!contentType && contentType.startsWith("image/");
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

  return (
    <ul className="mt-1 flex flex-col gap-1.5">
      {query.data.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={attachment.download_url}
            target="_blank"
            rel="noreferrer"
            // The server still forces `Content-Disposition: attachment` on
            // every signed URL (`ChatService.listMessageAttachments` passes
            // `forceDownload: true` — spec/behavior/chat/README.md's "trust
            // boundary" section is explicit this is a security mitigation,
            // not a UX one: it's what keeps a member-uploaded object whose
            // declared MIME lied about its content from rendering as HTML).
            // What changed under #1231's batched signing is only the saved
            // *filename* — the batch API takes one `download` option for the
            // whole call, not a per-file name, so it can no longer force
            // `row.filename` the way the old per-row call did. This
            // attribute is the client-side best-effort restoration of that
            // display name; the security-relevant disposition itself needs
            // no client help.
            download={attachment.filename}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2 py-1.5",
              "text-[12.5px] hover:bg-accent-subtle hover:text-accent-text",
            )}
          >
            {isPreviewable(attachment.content_type) ? (
              /* A plain <img>, not next/image. The src is a per-request signed
                 Storage URL on a host the Next image loader is not configured
                 for, and routing it through /_next/image would strip the query
                 string the signature lives in. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachment.download_url}
                alt={attachment.filename}
                className="max-h-64 max-w-full rounded"
              />
            ) : (
              <>
                <AttachGlyph className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{attachment.filename}</span>
                {attachment.byte_size != null ? (
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(attachment.byte_size)}
                  </span>
                ) : null}
              </>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
