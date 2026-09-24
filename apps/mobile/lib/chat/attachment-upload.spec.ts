import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pickAndUploadPhoto,
  resolveUploadable,
  safeBasename,
} from "./attachment-upload";

/**
 * These pin the two decisions that are easy to get wrong and expensive to get
 * wrong: which picks are re-encoded, and whether a failure is ever silent.
 *
 * `vitest.setup.ts` mocks the picker to "permission denied / cancelled" by
 * default, so each happy-path test opts in explicitly.
 */

const picker = vi.mocked(ImagePicker);
const fs = vi.mocked(FileSystem);
const manipulator = vi.mocked(ImageManipulator);

const TICKET = {
  upload_url: "https://storage.example/put",
  storage_path: "chapters/c/chat/m/photo.jpg",
};

function grantedLibrary() {
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
  fs.getInfoAsync.mockResolvedValue({ exists: true, size: 2048 } as never);
  fs.uploadAsync.mockResolvedValue({ status: 200, body: "" } as never);
  // `vitest.setup.ts`'s module factory runs once, so the default-denied
  // permission has to be restored per test after `clearAllMocks`.
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: false,
    canAskAgain: true,
  } as never);
});

describe("safeBasename", () => {
  it("strips a directory part so the claim stays inside the minted prefix", () => {
    // The API derives the storage path from this name and then re-checks the
    // claimed path against the prefix it minted. A separator here would fail
    // that check at send time, long after the bytes were uploaded.
    expect(safeBasename("file:///var/tmp/IMG_0001.HEIC", "photo.jpg")).toBe(
      "IMG_0001.HEIC",
    );
  });

  it("falls back when there is nothing usable left", () => {
    expect(safeBasename("///", "photo.jpg")).toBe("photo.jpg");
  });
});

describe("resolveUploadable", () => {
  it("does NOT re-encode an animated GIF", async () => {
    // The whole point of the conditional transcode. A GIF sent as a file
    // already works through the `document` kind, and flattening it to JPEG
    // would silently drop the animation — a worse bug than the HEIC one this
    // transcode exists to fix.
    const result = await resolveUploadable({
      uri: "file:///reaction.gif",
      fileName: "reaction.gif",
      mimeType: "image/gif",
    });

    expect(result.contentType).toBe("image/gif");
    expect(result.uri).toBe("file:///reaction.gif");
    expect(manipulator.manipulate).not.toHaveBeenCalled();
  });

  it("does NOT re-encode a PNG, so transparency survives", async () => {
    const result = await resolveUploadable({
      uri: "file:///logo.png",
      fileName: "logo.png",
      mimeType: "image/png",
    });

    expect(result.contentType).toBe("image/png");
    expect(manipulator.manipulate).not.toHaveBeenCalled();
  });

  it("re-encodes HEIC to JPEG, and renames to match", async () => {
    // iOS hands HEIC back from the library. `image/heic` is on neither the
    // `document` allowlist nor the chat bucket, so without this the mint 400s.
    const result = await resolveUploadable({
      uri: "file:///IMG_0001.HEIC",
      fileName: "IMG_0001.HEIC",
      mimeType: "image/heic",
    });

    expect(manipulator.manipulate).toHaveBeenCalledWith("file:///IMG_0001.HEIC");
    expect(result.contentType).toBe("image/jpeg");
    expect(result.filename).toBe("IMG_0001.jpg");
    expect(result.uri).toBe("file:///out.jpg");
  });

  it("falls back to the extension when the picker reports no usable type", async () => {
    // Android sometimes reports application/octet-stream.
    const result = await resolveUploadable({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "application/octet-stream",
    });

    expect(result.contentType).toBe("image/jpeg");
    expect(manipulator.manipulate).not.toHaveBeenCalled();
  });

  it("re-encodes a JPEG whose extension is off the allowlist, instead of refusing it", async () => {
    // A `.jfif` saved by Chrome reports image/jpeg. Accepting on the MIME
    // alone would skip the transcode and then be refused by
    // `inspectUploadFile`, which also requires an allowlisted extension —
    // telling the member "Chat accepts common images" about an actual JPEG.
    const result = await resolveUploadable({
      uri: "file:///photo.jfif",
      fileName: "photo.jfif",
      mimeType: "image/jpeg",
    });

    expect(manipulator.manipulate).toHaveBeenCalled();
    expect(result.filename).toBe("photo.jpg");
    expect(result.contentType).toBe("image/jpeg");
  });

  it("re-encodes when the picker supplies no filename at all", async () => {
    // iOS returns a null fileName for a limited-permission library pick.
    const result = await resolveUploadable({
      uri: "file:///var/tmp/ABC-123",
      fileName: null,
    });

    expect(result.contentType).toBe("image/jpeg");
    expect(result.filename.endsWith(".jpg")).toBe(true);
  });
});

describe("pickAndUploadPhoto — size accounting", () => {
  it("measures the TRANSCODED file, not the picked one", async () => {
    // The decisive case: a quality-1.0 JPEG re-encode of a large HEIC is
    // routinely bigger than the HEIC. Trusting `asset.fileSize` here would
    // gate on the wrong number, declare the wrong `size_bytes`, and record the
    // wrong byteSize on every iOS photo.
    grantedLibrary();
    picked({
      uri: "file:///IMG_0001.HEIC",
      fileName: "IMG_0001.HEIC",
      mimeType: "image/heic",
      fileSize: 18 * 1024 * 1024,
    });
    // `file:///out.jpg` is what the mocked manipulator writes.
    fs.getInfoAsync.mockResolvedValue({
      exists: true,
      size: 35 * 1024 * 1024,
    } as never);
    const requestUploadUrl = vi.fn();

    const result = await pickAndUploadPhoto("channel-1", requestUploadUrl);

    expect(fs.getInfoAsync).toHaveBeenCalledWith("file:///out.jpg");
    expect(result).toEqual({
      status: "refused",
      reason: "Photos can be up to 25 MB.",
    });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("still trusts the picker's size when nothing was transcoded", async () => {
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 4096,
    });

    await pickAndUploadPhoto("channel-1", vi.fn().mockResolvedValue(TICKET));

    expect(fs.getInfoAsync).not.toHaveBeenCalled();
  });

  it("refuses instead of throwing when the picked asset cannot be stat'd", async () => {
    // A limited-permission iOS asset or an Android provider URI can make
    // getInfoAsync reject. Escaping here would become an unhandled rejection:
    // no chip, no hint, a spinner that just stops.
    grantedLibrary();
    picked({ uri: "file:///gone.jpg", fileName: "gone.jpg", mimeType: "image/jpeg" });
    fs.getInfoAsync.mockRejectedValue(new Error("ENOENT") as never);

    const result = await pickAndUploadPhoto("channel-1", vi.fn());

    expect(result.status).toBe("refused");
  });

  it("refuses instead of throwing when the picker itself rejects", async () => {
    // Android rejects a second launchImageLibraryAsync while one is open.
    picker.requestMediaLibraryPermissionsAsync.mockRejectedValue(
      new Error("already active") as never,
    );

    const result = await pickAndUploadPhoto("channel-1", vi.fn());

    expect(result.status).toBe("refused");
  });
});

describe("pickAndUploadPhoto", () => {
  it("refuses with a reason when the library is denied, and never mints", async () => {
    const requestUploadUrl = vi.fn();

    const result = await pickAndUploadPhoto("channel-1", requestUploadUrl);

    expect(result.status).toBe("refused");
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("points at Settings once the prompt can no longer be shown", async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    } as never);

    const result = await pickAndUploadPhoto("channel-1", vi.fn());

    expect(result).toEqual({
      status: "refused",
      reason: "Allow photo access for Frapp in Settings to send a photo.",
    });
  });

  it("reports a cancel as a cancel, not a failure", async () => {
    grantedLibrary();
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true } as never);

    const result = await pickAndUploadPhoto("channel-1", vi.fn());

    expect(result).toEqual({ status: "cancelled" });
  });

  it("refuses an oversized photo before spending a request", async () => {
    // Gate before minting: a 40 MB pick should cost no round trip and read as
    // a sentence, not as the bucket's raw non-JSON 400.
    grantedLibrary();
    picked({ uri: "file:///big.jpg", fileName: "big.jpg", mimeType: "image/jpeg" });
    fs.getInfoAsync.mockResolvedValue({
      exists: true,
      size: 40 * 1024 * 1024,
    } as never);
    const requestUploadUrl = vi.fn();

    const result = await pickAndUploadPhoto("channel-1", requestUploadUrl);

    expect(result).toEqual({
      status: "refused",
      reason: "Photos can be up to 25 MB.",
    });
    expect(requestUploadUrl).not.toHaveBeenCalled();
    expect(fs.uploadAsync).not.toHaveBeenCalled();
  });

  it("declares the size so the API's own ceiling check runs", async () => {
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });
    const requestUploadUrl = vi.fn().mockResolvedValue(TICKET);

    await pickAndUploadPhoto("channel-1", requestUploadUrl);

    expect(requestUploadUrl).toHaveBeenCalledWith({
      id: "channel-1",
      body: {
        filename: "photo.jpg",
        content_type: "image/jpeg",
        size_bytes: 2048,
      },
    });
  });

  it("PUTs the bytes and returns the claim the send will carry", async () => {
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });

    const result = await pickAndUploadPhoto(
      "channel-1",
      vi.fn().mockResolvedValue(TICKET),
    );

    expect(fs.uploadAsync).toHaveBeenCalledWith(
      "https://storage.example/put",
      "file:///photo.jpg",
      expect.objectContaining({
        httpMethod: "PUT",
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    expect(result).toEqual({
      status: "attached",
      attachment: {
        storagePath: "chapters/c/chat/m/photo.jpg",
        filename: "photo.jpg",
        contentType: "image/jpeg",
        byteSize: 2048,
      },
    });
  });

  it("refuses rather than staging a chip when the PUT fails", async () => {
    // A chip whose bytes never landed is the worst outcome: the send claims a
    // path that 404s on download.
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });
    fs.uploadAsync.mockResolvedValue({ status: 403, body: "" } as never);

    const result = await pickAndUploadPhoto(
      "channel-1",
      vi.fn().mockResolvedValue(TICKET),
    );

    expect(result.status).toBe("refused");
  });

  it("refuses rather than throwing when the mint returns a camelCase ticket", async () => {
    // `readSignedUpload` throws on the camelCase service shape. Mobile has no
    // toast, so an exception escaping here would be invisible to the member.
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });

    const result = await pickAndUploadPhoto(
      "channel-1",
      vi.fn().mockResolvedValue({
        signedUrl: "https://storage.example/put",
        storagePath: "chapters/c/chat/m/photo.jpg",
      }),
    );

    expect(result.status).toBe("refused");
    expect(fs.uploadAsync).not.toHaveBeenCalled();
  });
});
