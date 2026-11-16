import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

/**
 * Downloads a member's file into the cache and hands it to the system share
 * sheet: a chat image from the viewer (#2874, `lib/chat/share-attachment.ts`)
 * and a library document from s12 (#4409, `lib/more/document-file.ts`).
 *
 * The sheet takes a local file, not a URL, so the file is downloaded first.
 * Downloading it never shows it as a page: `downloadAsync` writes the bytes to
 * disk whatever `Content-Disposition` the signed URL carries, and what opens
 * the file afterwards is whatever app the member picks, which types it by the
 * extension the caller chose. So every caller names the file with an
 * extension from an upload allowlist: chat's from the declared type, a
 * document's from the type the library files it under, else its stored
 * extension when that is on the `document` list. Never one a member typed and
 * nothing checked (`spec/behavior/chat/README.md` § File and image uploads).
 *
 * **What the sheet offers.** iOS heads the sheet with the file's name and
 * thumbnail and offers Save to Files and the installed apps that take the
 * type. It does not offer Save Image (to Photos): that
 * action writes to the photo library, which iOS allows only with an
 * `NSPhotoLibraryAddUsageDescription` purpose string the app doesn't declare,
 * and without it iOS terminates the app. So the iOS sheet excludes it, and the
 * purpose string is an integrator change to the frozen `app.json` (#2888).
 * Android lists the installed apps that accept the type, so what opening or
 * saving means there depends on the device (Drive, a PDF viewer, Files).
 */
export interface RemoteFile {
  /**
   * Names the file's cache folder (a chat attachment's id, a document's id),
   * so two files with the same name never overwrite each other while a share
   * sheet is still reading one.
   */
  key: string;
  url: string;
  /** One safe path segment, its extension already following the type. */
  name: string;
  mimeType: string | null;
}

export interface ShareRemoteFileOptions {
  /** The cache folder this caller's files live under. */
  folder: string;
  /** Android's chooser title. */
  dialogTitle: string;
  /**
   * Asked once the download lands: a caller that has moved on since (a
   * viewer that closed, a later tap) must not have a sheet appear over
   * whatever the member is doing now.
   */
  shouldPresent?: () => boolean;
}

/**
 * iOS activities that write somewhere the app holds no permission for.
 * Save to Camera Roll needs the photo-library purpose string (above);
 * Assign to Contact writes a contact photo.
 */
const EXCLUDED_IOS_ACTIVITIES = [
  "com.apple.UIKit.activity.SaveToCameraRoll",
  "com.apple.UIKit.activity.AssignToContact",
];

/** Longest name stem a caller writes, well under every file system's limit. */
const MAX_STEM_LENGTH = 80;

/**
 * A member-chosen name made safe to be one path segment: its own extension
 * dropped (the caller adds one from the declared type), anything but letters,
 * digits, `-` and `_` collapsed to `_`, and capped at `MAX_STEM_LENGTH`.
 * Empty when nothing usable is left, for the caller to substitute its own.
 */
export function safeFileStem(name: string): string {
  return name
    .replace(/\.[^./\\]*$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_STEM_LENGTH);
}

/**
 * False when the file couldn't be downloaded or shared, for the caller to say
 * so. True once the sheet was presented, or when `shouldPresent` declined it.
 * A member who dismisses the sheet is not a failure.
 */
export async function shareRemoteFile(
  file: RemoteFile,
  { folder, dialogTitle, shouldPresent = () => true }: ShareRemoteFileOptions,
): Promise<boolean> {
  try {
    const cache = FileSystem.cacheDirectory;
    if (!cache) return false;
    const onIos = Platform.OS === "ios";
    if (!onIos && !(await Sharing.isAvailableAsync())) return false;

    const directory = `${cache}${folder}/${encodeURIComponent(file.key)}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const download = await FileSystem.downloadAsync(
      file.url,
      `${directory}${file.name}`,
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
        dialogTitle,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      });
    }
    return true;
  } catch {
    return false;
  }
}
