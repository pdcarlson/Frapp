import {
  uploadPickedImage,
  type PickedImage,
  type RequestSignedUpload,
  type UploadedImage,
} from "@/lib/chat/attachment-upload";
import { moduleRefusalOf } from "@/lib/module-refusal";
import { subscriptionRefusalOf } from "@/lib/subscription-refusal";

/**
 * The PUT half of `attachment-upload.ts`'s pipeline for a route behind the
 * chapter gates: s21's documents (`lib/more/document-upload.ts`) and s20's
 * service proof (`lib/more/service-proof.ts`). Their mint routes sit under
 * the subscription gate and a module gate, as the write they lead to does, so
 * a refused mint is either a gate only an officer can lift or an ordinary
 * failure worth retrying, and the sheet treats the two differently (#2297).
 *
 * One copy rather than one per kind: the two had grown line-for-line twins,
 * and a fix to how a gate is recognised would otherwise reach one sheet and
 * not the other, leaving that one offering a retry that cannot win.
 */

/** The member's sentences for the two gates, in the kind's own words. */
export interface GateCopy {
  /** The chapter's subscription isn't active (`SUBSCRIPTION_REFUSAL_COPY`). */
  subscription: string;
  /** The module is switched off (`MODULE_REFUSAL_COPY`). */
  module: string;
}

/** The member's sentence for a gate refusal, or `null` for any other failure. */
export function gateRefusalOf(error: unknown, copy: GateCopy): string | null {
  if (subscriptionRefusalOf(error)) return copy.subscription;
  if (moduleRefusalOf(error)) return copy.module;
  return null;
}

export type GatedUploadResult =
  | { status: "uploaded"; image: UploadedImage }
  /**
   * Nothing landed. `final` is a gate only an officer can lift: the sheet
   * withdraws its action rather than invite a retry that cannot win.
   */
  | { status: "refused"; reason: string; final: boolean };

/**
 * Mint a signed URL and PUT the picked photo to it, telling a gate refusal
 * from any other failure. Never rejects.
 */
export async function uploadPickedImageGated(
  image: PickedImage,
  requestUploadUrl: RequestSignedUpload,
  copy: GateCopy,
): Promise<GatedUploadResult> {
  // `uploadPickedImage` turns a refused mint into a sentence, so the error
  // itself is caught on its way out to tell a gate from a failure.
  let gated: string | null = null;
  const put = await uploadPickedImage(image, async (body) => {
    try {
      return await requestUploadUrl(body);
    } catch (error) {
      gated = gateRefusalOf(error, copy);
      throw error;
    }
  });
  if (put.status === "uploaded") return put;
  return gated !== null
    ? { status: "refused", reason: gated, final: true }
    : { status: "refused", reason: put.reason, final: false };
}
