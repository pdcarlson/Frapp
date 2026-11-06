import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGO_SIZE_REFUSAL,
  LOGO_TYPE_REFUSAL,
  pickAndSetChapterLogo,
} from "./chapter-logo";

/**
 * Chapter setup's optional logo (#3351). What these pin: the mint carries only
 * the two fields the logo route declares (the API forbids `size_bytes`, which
 * the shared pipeline always sends), the confirm names the minted path, the
 * image gate runs before any request, and nothing throws past the screen.
 */

const picker = vi.mocked(ImagePicker);
const fs = vi.mocked(FileSystem);

const TICKET = {
  upload_url: "https://storage.example/put",
  storage_path: "chapters/c/branding/logo-1.png",
};

const requestUploadUrl = vi.fn();
const confirm = vi.fn();

function granted() {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
  } as never);
}

function picked(asset: Record<string, unknown>) {
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [asset],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requestUploadUrl.mockResolvedValue(TICKET);
  confirm.mockResolvedValue({});
  fs.getInfoAsync.mockResolvedValue({ exists: true, size: 2048 } as never);
  fs.uploadAsync.mockResolvedValue({ status: 200, body: "" } as never);
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: false,
    canAskAgain: true,
  } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as never);
});

const run = () => pickAndSetChapterLogo({ requestUploadUrl, confirm });

describe("pickAndSetChapterLogo", () => {
  it("mints with only the declared fields, PUTs, then confirms the minted path", async () => {
    granted();
    picked({
      uri: "file:///crest.png",
      fileName: "crest.png",
      mimeType: "image/png",
      fileSize: 4096,
    });

    await expect(run()).resolves.toEqual({ status: "updated" });

    expect(requestUploadUrl).toHaveBeenCalledWith({
      filename: "crest.png",
      content_type: "image/png",
    });
    expect(fs.uploadAsync).toHaveBeenCalledWith(
      TICKET.upload_url,
      "file:///crest.png",
      expect.objectContaining({ httpMethod: "PUT" }),
    );
    expect(confirm).toHaveBeenCalledWith(TICKET.storage_path);
  });

  it("crops to a square, since every surface draws the mark in a square", async () => {
    granted();
    await run();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    );
  });

  it("asks for photo access in words, and sends nothing without it", async () => {
    await expect(run()).resolves.toEqual({
      status: "refused",
      reason: "Frapp needs access to your photos to add a logo.",
    });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("is a quiet no-op when the officer backs out of the picker", async () => {
    granted();
    await expect(run()).resolves.toEqual({ status: "cancelled" });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses an image over the size cap before minting", async () => {
    granted();
    picked({
      uri: "file:///big.png",
      fileName: "big.png",
      mimeType: "image/png",
      fileSize: 26 * 1024 * 1024,
    });
    await expect(run()).resolves.toEqual({
      status: "refused",
      reason: LOGO_SIZE_REFUSAL,
    });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a file that can't be made an accepted image type", async () => {
    granted();
    picked({
      uri: "file:///x.heic",
      fileName: "x.heic",
      mimeType: "image/heic",
    });
    const { ImageManipulator } = await import("expo-image-manipulator");
    vi.mocked(ImageManipulator.manipulate).mockImplementationOnce(() => {
      throw new Error("cannot decode");
    });
    await expect(run()).resolves.toEqual({
      status: "refused",
      reason: LOGO_TYPE_REFUSAL,
    });
  });

  it("does not confirm when the upload fails, and says so in plain words", async () => {
    granted();
    picked({
      uri: "file:///crest.png",
      fileName: "crest.png",
      mimeType: "image/png",
    });
    fs.uploadAsync.mockResolvedValue({ status: 500, body: "" } as never);

    const result = await run();

    expect(result.status).toBe("refused");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows the API's own reason when the confirm is refused", async () => {
    granted();
    picked({
      uri: "file:///crest.png",
      fileName: "crest.png",
      mimeType: "image/png",
    });
    confirm.mockRejectedValue({
      statusCode: 400,
      message: "storage_path does not reference an uploaded logo",
    });
    await expect(run()).resolves.toEqual({
      status: "refused",
      reason: "storage_path does not reference an uploaded logo",
    });
  });
});
