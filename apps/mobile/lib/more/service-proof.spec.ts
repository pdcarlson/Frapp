import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import {
  SERVICE_RECEIPT_REQUIRED_MESSAGE,
  moduleDisabledMessage,
} from "@repo/validation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import {
  PROOF_SIZE_REFUSAL,
  pickProofPhoto,
  receiptRequiredOf,
  uploadProofPhoto,
} from "./service-proof";

/**
 * s20's photo proof. What these pin: the pick sends nothing, the upload mints
 * on the proof route's body and PUTs the bytes, a gate only an officer can
 * lift comes back `final` in the member's words while every other failure
 * stays retryable, and the receipt-policy 400 is recognised by its exact
 * message and nothing looser.
 */

const picker = vi.mocked(ImagePicker);
const fs = vi.mocked(FileSystem);

const TICKET = {
  upload_url: "https://storage.example/put",
  storage_path: "chapters/c/service-proof/p/receipt.jpg",
  proof_id: "p",
};

const IMAGE = {
  uri: "file:///receipt.jpg",
  filename: "receipt.jpg",
  contentType: "image/jpeg",
  byteSize: 4096,
};

const requestUploadUrl = vi.fn();

function wireError(statusCode: number, message: string) {
  return { statusCode, error: "Error", message, requestId: "req_test" };
}

beforeEach(() => {
  vi.clearAllMocks();
  requestUploadUrl.mockResolvedValue(TICKET);
  fs.getInfoAsync.mockResolvedValue({ exists: true, size: 2048 } as never);
  fs.uploadAsync.mockResolvedValue({ status: 200, body: "" } as never);
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
  } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as never);
});

describe("pickProofPhoto", () => {
  it("returns the gated photo and sends nothing", async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///receipt.jpg",
          fileName: "receipt.jpg",
          mimeType: "image/jpeg",
          fileSize: 4096,
        },
      ],
    } as never);

    await expect(pickProofPhoto()).resolves.toEqual({
      status: "picked",
      image: IMAGE,
    });
    expect(fs.uploadAsync).not.toHaveBeenCalled();
  });

  it("refuses an oversized photo in the proof copy", async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///huge.jpg",
          fileName: "huge.jpg",
          mimeType: "image/jpeg",
          fileSize: 26 * 1024 * 1024,
        },
      ],
    } as never);

    await expect(pickProofPhoto()).resolves.toEqual({
      status: "refused",
      reason: PROOF_SIZE_REFUSAL,
    });
  });
});

describe("uploadProofPhoto", () => {
  it("mints a proof URL, PUTs the bytes, and hands back the storage path", async () => {
    await expect(uploadProofPhoto(IMAGE, requestUploadUrl)).resolves.toEqual({
      status: "uploaded",
      storagePath: TICKET.storage_path,
    });

    expect(requestUploadUrl).toHaveBeenCalledWith({
      filename: "receipt.jpg",
      content_type: "image/jpeg",
      size_bytes: 4096,
    });
    expect(fs.uploadAsync).toHaveBeenCalledWith(
      TICKET.upload_url,
      IMAGE.uri,
      expect.objectContaining({
        httpMethod: "PUT",
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
  });

  it.each([
    [
      "the subscription gate",
      wireError(
        403,
        "Chapter subscription is not active; complete checkout to use this feature.",
      ),
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    ],
    [
      "the hours module switched off",
      wireError(403, moduleDisabledMessage("hours")),
      MODULE_REFUSAL_COPY.serviceHours,
    ],
  ])("reads a mint refused by %s as final", async (_label, error, copy) => {
    requestUploadUrl.mockRejectedValue(error);

    await expect(uploadProofPhoto(IMAGE, requestUploadUrl)).resolves.toEqual({
      status: "refused",
      reason: copy,
      final: true,
    });
    expect(fs.uploadAsync).not.toHaveBeenCalled();
  });

  it("keeps a failed PUT retryable", async () => {
    fs.uploadAsync.mockResolvedValue({ status: 500, body: "" } as never);

    await expect(uploadProofPhoto(IMAGE, requestUploadUrl)).resolves.toEqual(
      expect.objectContaining({ status: "refused", final: false }),
    );
  });
});

describe("receiptRequiredOf", () => {
  it("recognises the receipt policy's 400", () => {
    expect(
      receiptRequiredOf(wireError(400, SERVICE_RECEIPT_REQUIRED_MESSAGE)),
    ).toBe(true);
  });

  it.each([
    ["another 400", wireError(400, "description is required")],
    [
      "the same words on another status",
      wireError(403, SERVICE_RECEIPT_REQUIRED_MESSAGE),
    ],
    ["a network error", new Error("Network request failed")],
  ])("ignores %s", (_label, error) => {
    expect(receiptRequiredOf(error)).toBe(false);
  });
});
