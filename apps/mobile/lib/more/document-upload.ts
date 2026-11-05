import type { components } from "@repo/api-sdk";
import { MAX_UPLOAD_LABEL } from "@repo/validation";
import {
  pickImage,
  uploadFailureReason,
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
 * (`apps/web/components/documents/upload-document-dialog.tsx`): mint a signed
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
 * the sheet holds both fixed until a new photo is picked. Both ways around
 * that go wrong: renaming on the retry would report a title the API may never
 * have filed, and uploading the edit afresh would leave the first copy with no
 * row whenever the first confirm never landed.
 *
 * Photos only. A PDF or an Office file needs `expo-document-picker`, a native
 * module, so it waits for a store build.
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
      reason: reason ?? uploadFailureReason(error),
      final: reason !== null,
      sent: { image, uploaded: stored, title, folder },
    };
  }
}
