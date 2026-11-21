import { viewableImageExtension } from "@repo/chat-core/attachments";
import { safeFileStem, shareRemoteFile } from "@/lib/share-remote-file";

/**
 * Hands a chat image to the system share sheet (#2874), which is where a
 * member sends it on or keeps it.
 *
 * The download and the sheet are `shareRemoteFile`'s (`lib/share-remote-file.ts`),
 * which s12's documents share (#4409); what that module says about Save Image
 * on iOS applies here. The signed URL forces `Content-Disposition:
 * attachment`, which a download ignores.
 */
export interface ShareableAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  url: string;
}

/**
 * The name the shared file gets, or `null` when the attachment isn't a
 * viewable image.
 *
 * The stem is the sender's filename, made safe to be one path segment, and
 * the extension comes from the declared type. The API stores `filename`
 * unvalidated, and an app receiving the file types it by its extension (iOS
 * ignores a MIME type), so a sender's `a.html` over HTML bytes typed
 * `image/png` must arrive as `a.png`, never as a page.
 */
export function shareFileName(
  filename: string,
  contentType: string | null,
): string | null {
  const extension = viewableImageExtension(contentType);
  if (!extension) return null;
  return `${safeFileStem(filename) || "image"}.${extension}`;
}

/**
 * False when the image couldn't be downloaded or shared, for the caller to
 * say so. `shouldPresent` is asked once the download lands: a viewer that has
 * closed, or moved to another image, since the member tapped Share must not
 * have a share sheet appear over whatever they are doing now.
 */
export async function shareAttachment(
  attachment: ShareableAttachment,
  shouldPresent: () => boolean = () => true,
): Promise<boolean> {
  const name = shareFileName(attachment.filename, attachment.contentType);
  if (!name) return false;
  return shareRemoteFile(
    {
      key: attachment.id,
      url: attachment.url,
      name,
      mimeType: attachment.contentType,
    },
    { folder: "chat-share", dialogTitle: "Share image", shouldPresent },
  );
}
