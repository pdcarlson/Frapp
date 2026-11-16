import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import type { components } from "@repo/api-sdk";
import { definitiveRefusalMessage } from "@repo/chat-core/chat-client";
import {
  MAX_UPLOAD_LABEL,
  contentTypeByExtension,
  fileExtension,
  inspectUploadFile,
} from "@repo/validation";
import {
  byteSizeOf,
  pickImage,
  resolveUploadable,
  safeBasename,
  type ImagePickResult,
  type PickedImage,
  type RequestSignedUpload,
  type UploadedImage,
} from "@/lib/chat/attachment-upload";
import {
  gateRefusalOf,
  uploadPickedImageGated,
  type GateCopy,
} from "@/lib/chat/gated-upload";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

/**
 * s21: put a photo into the chapter library from the phone (#3399).
 *
 * The same three wire steps as web's `useDocumentUpload`
 * (`apps/web/components/documents/upload-document-panel.tsx`): mint a signed
 * URL with `POST /v1/documents/upload-url`, PUT the bytes, confirm with
 * `POST /v1/documents`. The pick and the PUT are `lib/chat/attachment-upload.ts`'s,
 * split so the sheet can show the pick before anything is sent: a member who
 * cancels after choosing a photo leaves no object in the bucket, which a
 * pick-and-upload in one step would (`attachment-upload.ts` § "The bytes land
 * before the message exists").
 *
 * ## A confirm that fails keeps the bytes it already sent
 *
 * The bytes land before `POST /v1/documents` files them. When that confirm
 * fails, the refusal carries the upload, and a retry passes it back so only
 * the confirm runs again: a second mint would name a new storage path and PUT
 * a second copy, leaving the first unreferenced. A member who gives up at that
 * point does leave the object behind, as web's flow does (#1428).
 *
 * A confirm can fail on the phone after it committed on the server: the
 * response is lost to a dropped connection. The retry then confirms a path
 * that is already filed, and the API answers with that row, unchanged, rather
 * than a second one (`chapter_documents_storage_path_key`, #3399). So a retry
 * files those bytes with the title and folder they were first sent with, and
 * the sheet holds both fixed until a new photo is picked (except a folder an
 * officer has deleted or renamed since, which the sheet sends as none; its
 * header says why). Both ways around that go wrong: renaming on the retry
 * would report a title the API may never have filed, and uploading the edit
 * afresh would leave the first copy with no row whenever the first confirm
 * never landed.
 *
 * ## Two sources: Files and Photos
 *
 * {@link pickDocumentFile} opens the system file picker (`expo-document-picker`,
 * #3401): iOS's Files, which also lists iCloud Drive and any cloud app the
 * member has installed (Google Drive, OneDrive, Dropbox), and Android's
 * document picker, which lists Drive too. {@link pickDocumentPhoto} opens the
 * photo library, as it has since #3399. Both hand back a {@link PickedImage}
 * (the name is the pipeline's; it is any file), so the PUT and the confirm
 * below don't care which one it came from.
 *
 * The picker is a native module, so it reaches members only in a store build.
 * {@link canPickFiles} says whether this binary has it, and the sheet offers
 * Photos alone when it doesn't, rather than a row that would fail.
 *
 * Like the rest of the pipeline, nothing here throws: the sheet has no toast,
 * so every failure comes back as a sentence to show in it.
 */

/** The two mutations the screen holds, narrowed to what this needs. */
export interface DocumentUploadMutations {
  requestUploadUrl: RequestSignedUpload;
  confirm: (
    body: components["schemas"]["ConfirmDocumentUploadDto"],
  ) => Promise<unknown>;
}

/** Bytes in the bucket whose confirm failed, and the draft it was sent with. */
export interface SentUpload {
  image: PickedImage;
  uploaded: UploadedImage;
  title: string;
  folder: string | null;
}

export type DocumentUploadResult =
  /** `title` is the title the document is filed under. */
  | { status: "uploaded"; title: string }
  /**
   * Nothing was filed. `final` is a gate that only an officer can lift (the
   * chapter's subscription, or the documents module switched off): the sheet
   * withdraws Upload rather than invite a retry that cannot win (#2297).
   */
  | {
      status: "refused";
      reason: string;
      final: boolean;
      /**
       * Set when the bytes are already in the bucket and only the confirm
       * failed: pass it back as `uploadDocumentPhoto`'s `sent` to confirm
       * those bytes again, as they were sent, for the same photo.
       */
      sent?: SentUpload;
    };

export const DOCUMENT_TYPE_REFUSAL =
  "Documents from your phone can be JPEG, PNG, GIF or WebP photos.";
export const DOCUMENT_SIZE_REFUSAL = `Documents can be up to ${MAX_UPLOAD_LABEL}.`;

/**
 * A file from Files the library can't take. Pages, Numbers and Keynote are
 * named because they are what an iPhone makes by default, and the picker
 * greys them out without saying why.
 */
export const DOCUMENT_FILE_TYPE_REFUSAL =
  "Documents can be PDF, Word, Excel, PowerPoint, text, CSV or photo files. Export a Pages, Numbers or Keynote file as PDF first.";

/** A failed PUT of a file, in words that don't call a PDF a photo. */
export const DOCUMENT_UPLOAD_FAILED =
  "Couldn't upload that file. Try again in a moment.";

/** A Files pick that threw: the picker or the copy it makes failed. */
const FILE_PICK_FAILED = "Couldn't open that file. Try again in a moment.";

/** Where a picked document came from, for the sheet's "· from Files" line. */
export type DocumentSource = "files" | "photos";

/**
 * Whether this binary has the file picker. A build from before #3401 doesn't,
 * and the native-version check keeps an update from reaching one that lacks
 * it, but a JS bundle that asks first can never call a module that isn't
 * there. The web build's picker is a file input, so it always has one.
 */
export function canPickFiles(): boolean {
  // The web build's picker is a file input the package draws itself, with no
  // native module to look for.
  if (Platform.OS === "web") return true;
  try {
    return requireOptionalNativeModule("ExpoDocumentPicker") != null;
  } catch {
    return false;
  }
}

/**
 * The types the Files picker offers: every MIME on the `document` allowlist,
 * plus HEIC and HEIF, which iPhone photos saved to Files are, and which the
 * pick turns into JPEG ({@link resolveUploadable}) before the gate sees them.
 * Anything else is greyed out in the picker itself.
 */
export function documentPickerTypes(): string[] {
  return [
    ...new Set([
      ...Object.values(contentTypeByExtension("document")),
      "image/heic",
      "image/heif",
    ]),
  ];
}

const PHOTO_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
]);

/** A Files asset that is a photo, which goes through the photo path's transcode. */
function isPhotoFile(name: string, mimeType: string | undefined): boolean {
  return (
    (mimeType ?? "").startsWith("image/") ||
    PHOTO_EXTENSIONS.has(fileExtension(name))
  );
}

/**
 * Pick one file from Files (or Drive, iCloud, or whatever the system picker
 * lists) and gate it, uploading nothing. Never rejects.
 *
 * A photo picked from Files goes through the photo path's
 * `resolveUploadable`, so an iPhone's HEIC becomes JPEG and a 12 MP photo is
 * shrunk, as it would be from Photos. Anything else goes up as picked: the
 * gate is the `document` allowlist by extension and type, and the 25 MB cap.
 */
export async function pickDocumentFile(): Promise<ImagePickResult> {
  try {
    // Loaded here, not at the top: a binary without the module would throw at
    // import, and `canPickFiles` is the sheet's question to ask first.
    const DocumentPicker = await import("expo-document-picker");
    const result = await DocumentPicker.getDocumentAsync({
      type: documentPickerTypes(),
      // A copy in the app's cache, so the URI is a plain `file://` the PUT
      // can read (Android's provider URIs and iOS's security-scoped ones
      // aren't), and so a file from Drive is downloaded before the sheet
      // shows it as picked.
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return { status: "cancelled" };
    const asset = result.assets?.[0];
    if (!asset) return { status: "cancelled" };

    const name = safeBasename(asset.name ?? asset.uri, "file");
    let uploadable = {
      uri: asset.uri,
      filename: name,
      contentType: asset.mimeType ?? "",
    };
    if (isPhotoFile(name, asset.mimeType)) {
      try {
        uploadable = await resolveUploadable(
          {
            uri: asset.uri,
            fileName: name,
            mimeType: asset.mimeType,
            fileSize: asset.size,
          },
          "document",
        );
      } catch {
        return { status: "refused", reason: DOCUMENT_FILE_TYPE_REFUSAL };
      }
    }

    const size = await byteSizeOf(
      uploadable.uri,
      uploadable.uri === asset.uri ? asset.size : undefined,
    );
    const inspected = inspectUploadFile("document", {
      name: uploadable.filename,
      type: uploadable.contentType,
      size,
    });
    if (!inspected.ok) {
      return {
        status: "refused",
        reason:
          inspected.reason === "size"
            ? DOCUMENT_SIZE_REFUSAL
            : DOCUMENT_FILE_TYPE_REFUSAL,
      };
    }
    return {
      status: "picked",
      image: {
        uri: uploadable.uri,
        filename: uploadable.filename,
        contentType: inspected.contentType,
        byteSize: size,
      },
    };
  } catch {
    return { status: "refused", reason: FILE_PICK_FAILED };
  }
}

/** Pick one photo for s21. Never rejects. */
export function pickDocumentPhoto(): Promise<ImagePickResult> {
  return pickImage({
    kind: "document",
    copy: {
      askAccess: "Frapp needs access to your photos to upload one.",
      settingsAccess:
        "Allow photo access for Frapp in Settings to upload a photo.",
      type: DOCUMENT_TYPE_REFUSAL,
      size: DOCUMENT_SIZE_REFUSAL,
    },
  });
}

/**
 * The title a document gets when the member leaves the field blank: the
 * file's own name, as web's form does (`uploadDraft.title.trim() || file.name`).
 */
export function documentTitle(typed: string, image: PickedImage): string {
  return typed.trim() || image.filename;
}

/**
 * The member's sentences for a gate refusal. Both routes sit under the
 * documents controller's `@RequireModule('documents')` and, with no
 * `@FreeTier`, under the subscription gate.
 */
const DOCUMENT_GATE_COPY: GateCopy = {
  subscription: SUBSCRIPTION_REFUSAL_COPY.document,
  module: MODULE_REFUSAL_COPY.document,
};

/**
 * Upload a picked photo and file it, or, given `sent` from a refusal whose
 * confirm failed on this same photo, file those bytes again with the title
 * and folder they were sent with, without sending the bytes twice. Never
 * rejects.
 */
export async function uploadDocumentPhoto(
  image: PickedImage,
  draft: { title: string; folder: string | null },
  mutations: DocumentUploadMutations,
  sent?: SentUpload,
): Promise<DocumentUploadResult> {
  const retry = sent?.image === image ? sent : undefined;
  const title = retry ? retry.title : documentTitle(draft.title, image);
  const folder = retry ? retry.folder : draft.folder;
  let stored = retry?.uploaded;
  if (!stored) {
    const put = await uploadPickedImageGated(
      image,
      mutations.requestUploadUrl,
      DOCUMENT_GATE_COPY,
      DOCUMENT_UPLOAD_FAILED,
    );
    if (put.status !== "uploaded") return put;
    stored = put.image;
  }

  try {
    await mutations.confirm({
      storage_path: stored.storagePath,
      title,
      folder: folder ?? undefined,
      content_type: stored.contentType,
      byte_size: stored.byteSize,
    });
    return { status: "uploaded", title };
  } catch (error) {
    const reason = gateRefusalOf(error, DOCUMENT_GATE_COPY);
    return {
      status: "refused",
      reason:
        reason ?? definitiveRefusalMessage(error) ?? DOCUMENT_UPLOAD_FAILED,
      final: reason !== null,
      sent: { image, uploaded: stored, title, folder },
    };
  }
}
