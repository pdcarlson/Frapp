import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { safeBasename } from "./attachment-upload";

/**
 * Hands a chat image to the system share sheet, which is also where a member
 * saves it: iOS lists "Save Image" there, and Android offers the gallery and
 * Files apps (#2874).
 *
 * The share sheet takes a local file, not a URL, so the image is downloaded
 * into the cache first. The signed URL forces `Content-Disposition:
 * attachment`, which a download ignores, so this is the same file a member
 * gets from web's download action.
 */
export interface ShareableAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  url: string;
}

/** False when the image couldn't be downloaded or shared, for the caller to say so. */
export async function shareAttachment(
  attachment: ShareableAttachment,
): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    const cache = FileSystem.cacheDirectory;
    if (!cache) return false;

    // One directory per attachment, so two files with the same name never
    // overwrite each other while a share sheet is still reading one. The name
    // is the uploader's, which the share sheet shows, made safe to be one path
    // segment.
    const directory = `${cache}chat-share/${encodeURIComponent(attachment.id)}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const download = await FileSystem.downloadAsync(
      attachment.url,
      `${directory}${safeBasename(attachment.filename, "image")}`,
    );
    // `downloadAsync` resolves on any HTTP status and writes the error body to
    // the file, so an expired URL would otherwise share an XML error page.
    if (download.status !== 200) return false;

    await Sharing.shareAsync(download.uri, {
      dialogTitle: "Save or share image",
      ...(attachment.contentType ? { mimeType: attachment.contentType } : {}),
    });
    return true;
  } catch {
    return false;
  }
}
