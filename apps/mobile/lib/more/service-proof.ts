import { codeOf, statusOf } from "@repo/api-sdk";
import {
  MAX_UPLOAD_LABEL,
  SERVICE_RECEIPT_REQUIRED_CODE,
} from "@repo/validation";
import {
  pickImage,
  type ImagePickResult,
  type PickedImage,
  type RequestSignedUpload,
} from "@/lib/chat/attachment-upload";
import {
  uploadPickedImageGated,
  type GateCopy,
} from "@/lib/chat/gated-upload";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

/**
 * s20's photo proof: the "Add photo proof" row on the Log service hours sheet
 * (`components/service-hours/log-hours-sheet.tsx`).
 *
 * The same two wire steps as web's log dialog
 * (`apps/web/components/service/service-page.tsx`): mint a signed URL with
 * `POST /v1/service-entries/proof-upload-url`, PUT the bytes, then send the
 * returned `storage_path` as the create's `proof_path`. The pick and the PUT
 * are `lib/chat/attachment-upload.ts`'s, the pipeline chat, the profile photo,
 * the chapter logo and s21's documents already share, so a fix there reaches
 * this too, and a refused mint is told apart by `lib/chat/gated-upload.ts`,
 * as s21's is. Gated on the `proof` upload kind, the list the API checks.
 *
 * Photos only, like s21: a PDF needs `expo-document-picker`, a native module
 * no store build carries yet.
 *
 * Nothing here throws: the sheet has no toast, so every failure comes back as
 * a sentence to show in it.
 */

export const PROOF_TYPE_REFUSAL =
  "Proof from your phone can be a JPEG, PNG, GIF or WebP photo.";
export const PROOF_SIZE_REFUSAL = `Proof can be up to ${MAX_UPLOAD_LABEL}.`;

/**
 * What the sheet says once the API has refused an entry for want of proof:
 * the chapter's `wf_hours_receipt` workflow is on, and a member has no other
 * way to know (see {@link receiptRequiredOf}).
 */
export const RECEIPT_REQUIRED_COPY =
  "Your chapter needs a photo of your proof with each entry. Add one, then submit.";

/** Pick one photo for the proof row. Sends nothing. Never rejects. */
export function pickProofPhoto(): Promise<ImagePickResult> {
  return pickImage({
    kind: "proof",
    copy: {
      askAccess: "Frapp needs access to your photos to add proof.",
      settingsAccess:
        "Allow photo access for Frapp in Settings to add a photo.",
      type: PROOF_TYPE_REFUSAL,
      size: PROOF_SIZE_REFUSAL,
    },
  });
}

export type ProofUploadResult =
  | { status: "uploaded"; storagePath: string }
  /**
   * Nothing usable landed. `final` is a gate only an officer can lift (the
   * subscription, or the hours module switched off): the mint sits under the
   * same gates as the create, and the sheet withdraws Submit for it.
   */
  | { status: "refused"; reason: string; final: boolean };

/**
 * The member's sentences for a gate refusal: the mint route sits under the
 * same `@RequireModule('hours')` and subscription gate as the create.
 */
const PROOF_GATE_COPY: GateCopy = {
  subscription: SUBSCRIPTION_REFUSAL_COPY.serviceHours,
  module: MODULE_REFUSAL_COPY.serviceHours,
};

/** Mint a signed URL and PUT the picked photo to it. Never rejects. */
export async function uploadProofPhoto(
  image: PickedImage,
  requestUploadUrl: RequestSignedUpload,
): Promise<ProofUploadResult> {
  const put = await uploadPickedImageGated(
    image,
    requestUploadUrl,
    PROOF_GATE_COPY,
  );
  return put.status === "uploaded"
    ? { status: "uploaded", storagePath: put.image.storagePath }
    : put;
}

/**
 * Was this create refused because the chapter requires proof?
 *
 * The API says so with a 400 carrying `SERVICE_RECEIPT_REQUIRED_CODE`. The
 * code, never the message: this build is matched against whatever the API
 * sends for as long as it stays installed, and the message is English copy
 * that may be reworded. A member can't read the `wf_hours_receipt` workflow
 * beforehand: the chapter config route needs `chapter-config:view`.
 */
export function receiptRequiredOf(error: unknown): boolean {
  return (
    statusOf(error) === 400 && codeOf(error) === SERVICE_RECEIPT_REQUIRED_CODE
  );
}

/**
 * Was this create, sent with a `proof_path`, refused over that path?
 *
 * Any 400 but the receipt policy's. The sheet's own checks keep the other
 * fields inside what the API accepts, so a 400 to a create carrying proof is
 * `ServiceEntryService.assertValidProofPath` turning the path down: minted
 * under another chapter, or naming no object in the bucket. Retrying with the
 * same path can never win, so the sheet drops it and the next Submit uploads
 * the photo again. Read by status, not by the API's sentences, which carry no
 * code and may be reworded; at worst a 400 for some other reason costs one
 * extra upload.
 */
export function proofPathRefusedOf(error: unknown): boolean {
  return statusOf(error) === 400 && !receiptRequiredOf(error);
}
