import { serverMessageOf, statusOf } from "@repo/api-sdk";
import {
  MAX_UPLOAD_LABEL,
  SERVICE_RECEIPT_REQUIRED_MESSAGE,
} from "@repo/validation";
import {
  pickImage,
  uploadPickedImage,
  type ImagePickResult,
  type PickedImage,
  type RequestSignedUpload,
} from "@/lib/chat/attachment-upload";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";

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
 * this too. Gated on the `proof` upload kind, the list the API checks.
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

/** The member's sentence for a gate refusal, or `null` for any other failure. */
function gateRefusal(error: unknown): string | null {
  if (subscriptionRefusalOf(error))
    return SUBSCRIPTION_REFUSAL_COPY.serviceHours;
  if (moduleRefusalOf(error)) return MODULE_REFUSAL_COPY.serviceHours;
  return null;
}

/** Mint a signed URL and PUT the picked photo to it. Never rejects. */
export async function uploadProofPhoto(
  image: PickedImage,
  requestUploadUrl: RequestSignedUpload,
): Promise<ProofUploadResult> {
  // `uploadPickedImage` turns a refused mint into a sentence, so the error
  // itself is caught on its way out to tell a gate from a failure.
  let gated: string | null = null;
  const put = await uploadPickedImage(image, async (body) => {
    try {
      return await requestUploadUrl(body);
    } catch (error) {
      gated = gateRefusal(error);
      throw error;
    }
  });
  if (put.status === "uploaded") {
    return { status: "uploaded", storagePath: put.image.storagePath };
  }
  return gated !== null
    ? { status: "refused", reason: gated, final: true }
    : { status: "refused", reason: put.reason, final: false };
}

/**
 * Was this create refused because the chapter requires proof?
 *
 * The API says so with a 400 whose message is
 * `SERVICE_RECEIPT_REQUIRED_MESSAGE` and no `code`, so the message is the
 * only stable field; the constant is shared with the service that throws it.
 * A member can't read the `wf_hours_receipt` workflow beforehand: the chapter
 * config route needs `chapter-config:view`.
 */
export function receiptRequiredOf(error: unknown): boolean {
  return (
    statusOf(error) === 400 &&
    serverMessageOf(error) === SERVICE_RECEIPT_REQUIRED_MESSAGE
  );
}
