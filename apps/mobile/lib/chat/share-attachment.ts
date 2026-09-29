import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import { viewableImageExtension } from "@repo/chat-core/attachments";

/**
 * Hands a chat image to the system share sheet (#2874), which is where a
 * member sends it on or keeps it.
 *
 * The share sheet takes a local file, not a URL, so the image is downloaded
 * into the cache first. The signed URL forces `Content-Disposition:
 * attachment`, which a download ignores.
 *
 * **What "save" means here.** iOS offers Save to Files. It does not offer
 * Save Image (to Photos): that action writes to the photo library, which iOS
 * allows only with an `NSPhotoLibraryAddUsageDescription` purpose string the
 * app doesn't declare, and without it iOS terminates the app. So the iOS sheet
 * excludes it, and the purpose string is an integrator change to the frozen
 * `app.json` (#2888). Android lists the installed apps that accept an image,
 * so what saving means there depends on the device (a gallery, Files, Drive).
 */
export interface ShareableAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  url: string;
}

/** Longest name stem this writes, well under every file system's limit. */
const MAX_STEM_LENGTH = 80;

/**
 * iOS activities that write somewhere the app holds no permission for.
 * Save to Camera Roll needs the photo-library purpose string (above);
 * Assign to Contact writes a contact photo.
 */
const EXCLUDED_IOS_ACTIVITIES = [
  "com.apple.UIKit.activity.SaveToCameraRoll",
  "com.apple.UIKit.activity.AssignToContact",
];

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
  const stem = filename
    .replace(/\.[^./\\]*$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_STEM_LENGTH);
  return `${stem || "image"}.${extension}`;
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
  try {
    const name = shareFileName(attachment.filename, attachment.contentType);
    const cache = FileSystem.cacheDirectory;
    if (!name || !cache) return false;
    const onIos = Platform.OS === "ios";
    if (!onIos && !(await Sharing.isAvailableAsync())) return false;

    // One directory per attachment, so two files with the same name never
    // overwrite each other while a share sheet is still reading one.
    const directory = `${cache}chat-share/${encodeURIComponent(attachment.id)}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const download = await FileSystem.downloadAsync(
      attachment.url,
      `${directory}${name}`,
    );
    // `downloadAsync` resolves on any HTTP status and writes the error body to
    // the file, so an expired URL would otherwise share an XML error page.
    if (download.status !== 200) return false;
    if (!shouldPresent()) return true;

    if (onIos) {
      // React Native's own share sheet, because it can exclude activities and
      // expo-sharing can't.
      await Share.share(
        { url: download.uri },
        { excludedActivityTypes: EXCLUDED_IOS_ACTIVITIES },
      );
    } else {
      await Sharing.shareAsync(download.uri, {
        dialogTitle: "Share image",
        ...(attachment.contentType ? { mimeType: attachment.contentType } : {}),
      });
    }
    return true;
  } catch {
    return false;
  }
}
