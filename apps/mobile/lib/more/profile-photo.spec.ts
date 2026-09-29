import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PHOTO_SIZE_REFUSAL,
  PHOTO_TYPE_REFUSAL,
  pickAndSetProfilePhoto,
} from "./profile-photo";

/**
 * The mobile half of #732's upload. What these pin: the three wire steps run
 * in order against the path the ticket named, the `image` gate runs before any
 * request, and nothing ever throws past the screen.
 */

const picker = vi.mocked(ImagePicker);
const fs = vi.mocked(FileSystem);

const TICKET = {
  upload_url: "https://storage.example/put",
  storage_path: "chapters/c/profiles/u/abc.jpg",
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

const run = () => pickAndSetProfilePhoto({ requestUploadUrl, confirm });

describe("pickAndSetProfilePhoto", () => {
  it("mints, PUTs, then confirms the path the ticket named", async () => {
    granted();
    picked({
      uri: "file:///me.jpg",
      fileName: "me.jpg",
      mimeType: "image/jpeg",
      fileSize: 4096,
    });

    await expect(run()).resolves.toEqual({ status: "updated" });

    expect(requestUploadUrl).toHaveBeenCalledWith({
      filename: "me.jpg",
      content_type: "image/jpeg",
      size_bytes: 4096,
    });
    expect(fs.uploadAsync).toHaveBeenCalledWith(
      TICKET.upload_url,
      "file:///me.jpg",
      expect.objectContaining({
        httpMethod: "PUT",
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    expect(confirm).toHaveBeenCalledWith(TICKET.storage_path);
  });

  it("crops to a square, since every surface draws it in a circle", async () => {
    granted();

    await run();

    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    );
  });

  it("asks for photo access in words, and sends nothing without it", async () => {
    await expect(run()).resolves.toEqual({
      status: "refused",
      reason: "Frapp needs access to your photos to set one.",
    });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("is a quiet no-op when the member backs out", async () => {
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
      reason: PHOTO_SIZE_REFUSAL,
    });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses when the photo cannot be made an accepted type", async () => {
    granted();
    picked({ uri: "file:///x.heic", fileName: "x.heic", mimeType: "image/heic" });
    const { ImageManipulator } = await import("expo-image-manipulator");
    vi.mocked(ImageManipulator.manipulate).mockImplementationOnce(() => {
      throw new Error("cannot decode");
    });

    await expect(run()).resolves.toEqual({
      status: "refused",
      reason: PHOTO_TYPE_REFUSAL,
    });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("does not confirm when the PUT is refused", async () => {
    granted();
    picked({ uri: "file:///me.png", fileName: "me.png", mimeType: "image/png" });
    fs.uploadAsync.mockResolvedValue({ status: 400, body: "" } as never);

    const result = await run();

    expect(result.status).toBe("refused");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("never rejects, whatever throws", async () => {
    picker.requestMediaLibraryPermissionsAsync.mockRejectedValue(
      new Error("native module gone"),
    );

    await expect(run()).resolves.toMatchObject({ status: "refused" });
  });
});
