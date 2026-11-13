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

/** The context of the last `ImageManipulator.manipulate` call. */
function lastManipulation(manipulator: { manipulate: unknown }): {
  resize: ReturnType<typeof vi.fn>;
  renderAsync: ReturnType<typeof vi.fn>;
} {
  const results = vi.mocked(
    manipulator.manipulate as (...args: unknown[]) => unknown,
  ).mock.results;
  return results[results.length - 1]!.value as never;
}

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
    // The downscaled PNG re-encode is what goes up (#2912).
    expect(fs.uploadAsync).toHaveBeenCalledWith(
      TICKET.upload_url,
      "file:///out.jpg",
      expect.objectContaining({ httpMethod: "PUT" }),
    );
    expect(confirm).toHaveBeenCalledWith(TICKET.storage_path);
  });

  it("stores a logo that may be transparent as PNG, scaled to 512 (#2912)", async () => {
    granted();
    picked({
      uri: "file:///crest.png",
      fileName: "crest.png",
      mimeType: "image/png",
      width: 2000,
      height: 2000,
    });
    const { ImageManipulator, SaveFormat } =
      await import("expo-image-manipulator");

    await expect(run()).resolves.toEqual({ status: "updated" });

    const context = lastManipulation(ImageManipulator);
    expect(context.resize).toHaveBeenCalledWith({ width: 512 });
    const rendered = await context.renderAsync.mock.results[0]!.value;
    expect(rendered.saveAsync).toHaveBeenCalledWith({ format: SaveFormat.PNG });
  });

  it("stores a JPEG logo as JPEG, which has no transparency to keep", async () => {
    granted();
    picked({
      uri: "file:///crest.jpg",
      fileName: "crest.jpg",
      mimeType: "image/jpeg",
      width: 1200,
      height: 1200,
    });
    const { ImageManipulator, SaveFormat } =
      await import("expo-image-manipulator");

    await run();

    const rendered =
      await lastManipulation(ImageManipulator).renderAsync.mock.results[0]!
        .value;
    expect(rendered.saveAsync).toHaveBeenCalledWith(
      expect.objectContaining({ format: SaveFormat.JPEG }),
    );
    expect(requestUploadUrl).toHaveBeenCalledWith({
      filename: "crest.jpg",
      content_type: "image/jpeg",
    });
  });

  it("uploads a small logo within the bound as picked", async () => {
    granted();
    picked({
      uri: "file:///crest.jpg",
      fileName: "crest.jpg",
      mimeType: "image/jpeg",
      width: 400,
      height: 400,
      fileSize: 35_000,
    });
    const { ImageManipulator } = await import("expo-image-manipulator");

    await run();

    expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
    expect(fs.uploadAsync).toHaveBeenCalledWith(
      TICKET.upload_url,
      "file:///crest.jpg",
      expect.anything(),
    );
  });

  it("keeps the original when the re-encode would not be smaller", async () => {
    granted();
    picked({
      uri: "file:///crest.jpg",
      fileName: "crest.jpg",
      mimeType: "image/jpeg",
      width: 500,
      height: 500,
      fileSize: 300_000,
    });
    // The re-encode on disk is larger than the 300 KB original.
    fs.getInfoAsync.mockResolvedValue({ exists: true, size: 400_000 } as never);

    await run();

    expect(fs.uploadAsync).toHaveBeenCalledWith(
      TICKET.upload_url,
      "file:///crest.jpg",
      expect.anything(),
    );
  });

  it("never scales up a logo whose size the picker didn't report", async () => {
    granted();
    picked({
      uri: "file:///crest.png",
      fileName: "crest.png",
      mimeType: "image/png",
    });
    const { ImageManipulator } = await import("expo-image-manipulator");
    const measured = {
      width: 200,
      height: 200,
      saveAsync: vi.fn(),
    };
    vi.mocked(ImageManipulator.manipulate).mockImplementationOnce(
      () =>
        ({
          resize: vi.fn(),
          renderAsync: vi.fn().mockResolvedValue(measured),
        }) as never,
    );

    await run();

    const context = lastManipulation(ImageManipulator);
    expect(context.resize).not.toHaveBeenCalled();
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
    });
    fs.getInfoAsync.mockResolvedValue({
      exists: true,
      size: 26 * 1024 * 1024,
    } as never);
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

  it("never shows the API's field-named reason when the confirm is refused", async () => {
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
      reason: "Try again in a moment.",
    });
  });
});
