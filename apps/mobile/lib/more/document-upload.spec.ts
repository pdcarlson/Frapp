import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { moduleDisabledMessage } from "@repo/validation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import {
  DOCUMENT_SIZE_REFUSAL,
  DOCUMENT_TYPE_REFUSAL,
  documentTitle,
  pickDocumentPhoto,
  uploadDocumentPhoto,
} from "./document-upload";

/**
 * s21's wire steps (#3399). What these pin: the pick sends nothing, the upload
 * runs mint → PUT → confirm with the title and folder the member chose, and a
 * gate only an officer can lift comes back `final` with the member's copy,
 * while every other failure stays retryable.
 */

const picker = vi.mocked(ImagePicker);
const fs = vi.mocked(FileSystem);

const TICKET = {
  upload_url: "https://storage.example/put",
  storage_path: "chapters/c/documents/d/minutes.jpg",
};

const IMAGE = {
  uri: "file:///minutes.jpg",
  filename: "minutes.jpg",
  contentType: "image/jpeg",
  byteSize: 4096,
};

const requestUploadUrl = vi.fn();
const confirm = vi.fn();
const mutations = { requestUploadUrl, confirm };

function wireError(statusCode: number, message: string) {
  return { statusCode, error: "Forbidden", message, requestId: "req_test" };
}
const SUBSCRIPTION_REQUIRED = wireError(
  403,
  "Chapter subscription is not active; complete checkout to use this feature.",
);
const DOCUMENTS_OFF = wireError(403, moduleDisabledMessage("documents"));

beforeEach(() => {
  vi.clearAllMocks();
  requestUploadUrl.mockResolvedValue(TICKET);
  confirm.mockResolvedValue({});
  fs.getInfoAsync.mockResolvedValue({ exists: true, size: 2048 } as never);
  fs.uploadAsync.mockResolvedValue({ status: 200, body: "" } as never);
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
  } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as never);
});

describe("pickDocumentPhoto", () => {
  it("returns the gated photo and sends nothing", async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///minutes.jpg",
          fileName: "minutes.jpg",
          mimeType: "image/jpeg",
          fileSize: 4096,
        },
      ],
    } as never);

    await expect(pickDocumentPhoto()).resolves.toEqual({
      status: "picked",
      image: IMAGE,
    });
    expect(fs.uploadAsync).not.toHaveBeenCalled();
    // No crop: a document keeps the whole page the member photographed.
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.not.objectContaining({ allowsEditing: true }),
    );
  });

  it("refuses an oversized photo in the document copy", async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          // A PNG: a JPEG this size is shrunk under the cap rather than
          // refused (`attachment-upload.ts` § "Camera photos are shrunk").
          uri: "file:///huge.png",
          fileName: "huge.png",
          mimeType: "image/png",
          fileSize: 26 * 1024 * 1024,
        },
      ],
    } as never);

    await expect(pickDocumentPhoto()).resolves.toEqual({
      status: "refused",
      reason: DOCUMENT_SIZE_REFUSAL,
    });
  });

  it("asks for photo access in the upload's words", async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    } as never);

    await expect(pickDocumentPhoto()).resolves.toEqual({
      status: "refused",
      reason: "Allow photo access for Frapp in Settings to upload a photo.",
    });
  });

  it("refuses a photo it can't make uploadable in the document copy", async () => {
    // Off the allowlist, so it is transcoded, and the transcode fails.
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///scan.bmp",
          fileName: "scan.bmp",
          mimeType: "image/bmp",
        },
      ],
    } as never);
    vi.mocked(ImageManipulator).manipulate.mockImplementationOnce(() => {
      throw new Error("unsupported");
    });

    await expect(pickDocumentPhoto()).resolves.toEqual({
      status: "refused",
      reason: DOCUMENT_TYPE_REFUSAL,
    });
    expect(DOCUMENT_TYPE_REFUSAL).toMatch(/JPEG, PNG, GIF or WebP/);
  });
});

describe("documentTitle", () => {
  it("uses what the member typed, trimmed, else the file name, as web does", () => {
    expect(documentTitle("  Minutes — Aug 14 ", IMAGE)).toBe(
      "Minutes — Aug 14",
    );
    expect(documentTitle("   ", IMAGE)).toBe("minutes.jpg");
  });
});

describe("uploadDocumentPhoto", () => {
  it("mints, PUTs, then confirms with the title and folder chosen", async () => {
    await expect(
      uploadDocumentPhoto(
        IMAGE,
        { title: " Minutes ", folder: "Minutes" },
        mutations,
      ),
    ).resolves.toEqual({ status: "uploaded", title: "Minutes" });

    expect(requestUploadUrl).toHaveBeenCalledWith({
      filename: "minutes.jpg",
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
    expect(confirm).toHaveBeenCalledWith({
      storage_path: TICKET.storage_path,
      title: "Minutes",
      folder: "Minutes",
      content_type: "image/jpeg",
      byte_size: 4096,
    });
  });

  it("files at the library root when no folder is chosen", async () => {
    await expect(
      uploadDocumentPhoto(IMAGE, { title: "", folder: null }, mutations),
    ).resolves.toEqual({ status: "uploaded", title: "minutes.jpg" });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "minutes.jpg", folder: undefined }),
    );
  });

  it.each([
    [
      "the subscription gate",
      SUBSCRIPTION_REQUIRED,
      SUBSCRIPTION_REFUSAL_COPY.document,
    ],
    [
      "the documents module switched off",
      DOCUMENTS_OFF,
      MODULE_REFUSAL_COPY.document,
    ],
  ])(
    "reads %s refusing the mint as final, sending no bytes",
    async (_gate, error, copy) => {
      requestUploadUrl.mockRejectedValue(error);

      await expect(
        uploadDocumentPhoto(IMAGE, { title: "", folder: null }, mutations),
      ).resolves.toEqual({ status: "refused", reason: copy, final: true });
      expect(fs.uploadAsync).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "the subscription gate",
      SUBSCRIPTION_REQUIRED,
      SUBSCRIPTION_REFUSAL_COPY.document,
    ],
    [
      "the documents module switched off",
      DOCUMENTS_OFF,
      MODULE_REFUSAL_COPY.document,
    ],
  ])("reads %s refusing the confirm as final", async (_gate, error, copy) => {
    confirm.mockRejectedValue(error);

    await expect(
      uploadDocumentPhoto(IMAGE, { title: "", folder: null }, mutations),
    ).resolves.toMatchObject({ status: "refused", reason: copy, final: true });
  });

  it("keeps a failed PUT retryable", async () => {
    fs.uploadAsync.mockResolvedValue({ status: 500, body: "" } as never);

    await expect(
      uploadDocumentPhoto(IMAGE, { title: "", folder: null }, mutations),
    ).resolves.toEqual({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps a dropped connection on the confirm retryable, with the bytes it sent", async () => {
    confirm.mockRejectedValue(new TypeError("Network request failed"));

    await expect(
      uploadDocumentPhoto(IMAGE, { title: "", folder: null }, mutations),
    ).resolves.toEqual({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
      sent: {
        image: IMAGE,
        uploaded: {
          storagePath: TICKET.storage_path,
          filename: "minutes.jpg",
          contentType: "image/jpeg",
          byteSize: 4096,
        },
        title: "minutes.jpg",
        folder: null,
      },
    });
  });

  /** A first attempt whose confirm dropped, and the bytes it left behind. */
  async function droppedConfirm(draft: {
    title: string;
    folder: string | null;
  }) {
    confirm.mockRejectedValueOnce(new TypeError("Network request failed"));
    const first = await uploadDocumentPhoto(IMAGE, draft, mutations);
    const sent = first.status === "refused" ? first.sent : undefined;
    expect(sent).toBeDefined();
    requestUploadUrl.mockClear();
    fs.uploadAsync.mockClear();
    confirm.mockClear();
    return sent;
  }

  it("files bytes already sent without minting or PUTting again", async () => {
    const sent = await droppedConfirm({
      title: " Minutes ",
      folder: "Minutes",
    });

    await expect(
      uploadDocumentPhoto(
        IMAGE,
        { title: "Minutes", folder: "Minutes" },
        mutations,
        sent,
      ),
    ).resolves.toEqual({ status: "uploaded", title: "Minutes" });
    expect(requestUploadUrl).not.toHaveBeenCalled();
    expect(fs.uploadAsync).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        storage_path: TICKET.storage_path,
        title: "Minutes",
        folder: "Minutes",
      }),
    );
  });

  it("retries with the title and folder it was sent with, whatever the draft says", async () => {
    // The first confirm may have committed, and the API answers a filed path
    // with that row unchanged (#3399): a renamed retry would report a title
    // that was never filed, and a fresh upload would strand the first copy.
    const sent = await droppedConfirm({ title: "Minutes", folder: "Minutes" });

    await expect(
      uploadDocumentPhoto(
        IMAGE,
        { title: "Minutes — Nov 2", folder: "Bylaws" },
        mutations,
        sent,
      ),
    ).resolves.toEqual({ status: "uploaded", title: "Minutes" });
    expect(requestUploadUrl).not.toHaveBeenCalled();
    expect(fs.uploadAsync).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        storage_path: TICKET.storage_path,
        title: "Minutes",
        folder: "Minutes",
      }),
    );
  });

  it("hands a second failed retry the same bytes and draft", async () => {
    const sent = await droppedConfirm({ title: "", folder: null });
    confirm.mockRejectedValueOnce(new TypeError("Network request failed"));

    const again = await uploadDocumentPhoto(
      IMAGE,
      { title: "Typed later", folder: "Bylaws" },
      mutations,
      sent,
    );
    expect(again).toMatchObject({ status: "refused", sent });
  });

  it("uploads afresh for a different photo", async () => {
    const sent = await droppedConfirm({ title: "Minutes", folder: null });

    await uploadDocumentPhoto(
      { ...IMAGE, uri: "file:///bylaws.jpg", filename: "bylaws.jpg" },
      { title: "Minutes", folder: null },
      mutations,
      sent,
    );
    expect(requestUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("relays the API's reason for an ordinary refusal, and keeps it retryable", async () => {
    requestUploadUrl.mockRejectedValue({
      statusCode: 400,
      error: "Bad Request",
      message: "File exceeds the 25 MB upload limit",
      requestId: "req_test",
    });

    const result = await uploadDocumentPhoto(
      IMAGE,
      { title: "", folder: null },
      mutations,
    );
    expect(result).toMatchObject({ status: "refused", final: false });
    expect(result.status === "refused" && result.reason).toMatch(/25 MB/);
  });
});
