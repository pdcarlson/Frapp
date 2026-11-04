import type { components } from "@repo/api-sdk";
import { MAX_UPLOAD_LABEL } from "@repo/validation";
import {
  pickImage,
  uploadFailureReason,
  uploadPickedImage,
  type ImagePickResult,
  type PickedImage,
  type RequestSignedUpload,
  type UploadedImage,
} from "@/lib/chat/attachment-upload";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";

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
 * point does leave the object behind, as web's flow does, until #2197's sweep
 * exists.
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

export type DocumentUploadResult =
  | { status: "uploaded" }
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
       * failed: pass it back as `uploadDocumentPhoto`'s `uploaded` to retry
       * the confirm alone.
       */
      uploaded?: UploadedImage;
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
 * The member's sentence for a gate refusal, or `null` for any other failure.
 * Both routes sit under the documents controller's
 * `@RequireModule('documents')` and, with no `@FreeTier`, under the
 * subscription gate.
 */
function gateRefusal(error: unknown): string | null {
  if (subscriptionRefusalOf(error)) return SUBSCRIPTION_REFUSAL_COPY.document;
  if (moduleRefusalOf(error)) return MODULE_REFUSAL_COPY.document;
  return null;
}

/**
 * Upload a picked photo and file it, or, given `uploaded` from a refusal
 * whose confirm failed, file those bytes without sending them again. Never
 * rejects.
 */
export async function uploadDocumentPhoto(
  image: PickedImage,
  draft: { title: string; folder: string | null },
  mutations: DocumentUploadMutations,
  uploaded?: UploadedImage,
): Promise<DocumentUploadResult> {
  let stored = uploaded;
  if (!stored) {
    // `uploadPickedImage` turns a refused mint into a sentence, so the error
    // itself is caught on its way out to tell a gate from a failure.
    let gated: string | null = null;
    const sent = await uploadPickedImage(image, async (body) => {
      try {
        return await mutations.requestUploadUrl(body);
      } catch (error) {
        gated = gateRefusal(error);
        throw error;
      }
    });
    if (sent.status !== "uploaded") {
      return gated !== null
        ? { status: "refused", reason: gated, final: true }
        : { status: "refused", reason: sent.reason, final: false };
    }
    stored = sent.image;
  }

  try {
    await mutations.confirm({
      storage_path: stored.storagePath,
      title: documentTitle(draft.title, image),
      folder: draft.folder ?? undefined,
      content_type: stored.contentType,
      byte_size: stored.byteSize,
    });
    return { status: "uploaded" };
  } catch (error) {
    const reason = gateRefusal(error);
    return {
      status: "refused",
      reason: reason ?? uploadFailureReason(error),
      final: reason !== null,
      uploaded: stored,
    };
  }
}
