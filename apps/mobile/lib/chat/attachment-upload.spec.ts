import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_PHOTO_LIMIT,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_EDGE,
  pickChatPhotos,
  resolveUploadable,
  uploadChatPhoto,
  type RequestUploadUrl,
  safeBasename,
  uploadFailureReason,
} from "./attachment-upload";
import { describeChatPhoto } from "./photo-preview";

// The size, placeholder and preview copy are `photo-preview.spec.ts`'s; here
// only how the upload carries them. Nothing described unless a test says so.
vi.mock("./photo-preview", () => ({
  describeChatPhoto: vi.fn(),
}));
const describePhoto = vi.mocked(describeChatPhoto);
const NOT_DESCRIBED = {
  width: null,
  height: null,
  thumbhash: null,
  previewUri: null,
};

/**
 * These pin the two decisions that are easy to get wrong and expensive to get
 * wrong: which picks are re-encoded, and whether a failure is ever silent.
 *
 * `vitest.setup.ts` mocks the picker to "permission denied / cancelled" by
 * default, so each happy-path test opts in explicitly.
 */

/**
 * One photo through the whole chat path, pick then upload: what the composer
 * runs for each photo in the tray, in the order it runs them.
 */
async function pickAndUploadPhoto(
  channelId: string,
  requestUploadUrl: RequestUploadUrl,
) {
  const result = await pickChatPhotos();
  if (result.status !== "picked") return result;
  return uploadChatPhoto(channelId, result.photos[0]!, requestUploadUrl);
}

const picker = vi.mocked(ImagePicker);
const fs = vi.mocked(FileSystem);
const manipulator = vi.mocked(ImageManipulator);

beforeEach(() => {
  describePhoto.mockReset();
  describePhoto.mockResolvedValue(NOT_DESCRIBED);
});

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
  it("strips a directory part, so a URI fallback shows as a file name", () => {
    // With no `fileName` the picker URI is all there is, and the attachment's
    // display name is the file, not where the picker cached it.
    expect(safeBasename("file:///var/tmp/IMG_0001.HEIC", "photo.jpg")).toBe(
      "IMG_0001.HEIC",
    );
  });

  it("strips a query string a provider URI carries", () => {
    expect(
      safeBasename("content://media/external/IMG_0002.jpg?w=640", "photo.jpg"),
    ).toBe("IMG_0002.jpg");
  });

  it("keeps a non-ASCII name as the member named it (#2783)", () => {
    // The API squashes the storage key itself (`safeObjectFilename`), so
    // the client has no reason to show `Caf_.jpg` for `Café.jpg`.
    expect(safeBasename("Café #2.jpg", "photo.jpg")).toBe("Café #2.jpg");
  });

  it("trims surrounding whitespace, including a no-break space", () => {
    expect(safeBasename(" beach.jpg\u00a0", "photo.jpg")).toBe("beach.jpg");
  });

  it("falls back when there is nothing usable left", () => {
    expect(safeBasename("///", "photo.jpg")).toBe("photo.jpg");
    expect(safeBasename("file:///tmp/.", "photo.jpg")).toBe("photo.jpg");
    expect(safeBasename("file:///tmp/\u3000", "photo.jpg")).toBe("photo.jpg");
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

    expect(manipulator.manipulate).toHaveBeenCalledWith(
      "file:///IMG_0001.HEIC",
    );
    expect(result.contentType).toBe("image/jpeg");
    expect(result.filename).toBe("IMG_0001.jpg");
    expect(result.uri).toBe("file:///out.jpg");
  });

  it("keeps a non-ASCII name through the HEIC transcode", async () => {
    const result = await resolveUploadable({
      uri: "file:///IMG.HEIC",
      fileName: "Été à Paris.HEIC",
      mimeType: "image/heic",
    });

    expect(result.filename).toBe("Été à Paris.jpg");
  });

  it("drops whitespace after the extension, which the avatar key would keep", async () => {
    // `normalizeExtension` trims, so `jpg` + U+00A0 passes the allowlist here and
    // at the API. `UserService` then builds the avatar key from the untrimmed
    // extension, `<uuid>.jpg` + U+00A0, and storage-api refuses it. The old
    // squash hid this by turning the name into `beach.jpg_`.
    const result = await resolveUploadable(
      {
        uri: "file:///var/tmp/ABC-123.jpg",
        fileName: "beach.jpg\u00a0",
        mimeType: "image/jpeg",
      },
      "image",
    );

    expect(result.filename).toBe("beach.jpg");
    expect(manipulator.manipulate).not.toHaveBeenCalled();
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

describe("resolveUploadable — camera photos are shrunk", () => {
  function lastContext() {
    return manipulator.manipulate.mock.results.at(-1)?.value as {
      resize: ReturnType<typeof vi.fn>;
      renderAsync: ReturnType<typeof vi.fn>;
    };
  }

  it("shrinks a full-size camera JPEG to the long-edge cap", async () => {
    const result = await resolveUploadable({
      uri: "file:///IMG_0002.jpg",
      fileName: "IMG_0002.jpg",
      mimeType: "image/jpeg",
      width: 4032,
      height: 3024,
      fileSize: 4.1 * 1024 * 1024,
    });

    expect(manipulator.manipulate).toHaveBeenCalledWith("file:///IMG_0002.jpg");
    expect(lastContext().resize).toHaveBeenCalledWith({
      width: PHOTO_MAX_EDGE,
    });
    const rendered = await lastContext().renderAsync.mock.results[0]?.value;
    expect(rendered.saveAsync).toHaveBeenCalledWith({
      format: "jpeg",
      compress: PHOTO_JPEG_QUALITY,
    });
    expect(result).toEqual({
      uri: "file:///out.jpg",
      filename: "IMG_0002.jpg",
      contentType: "image/jpeg",
    });
  });

  it("caps the height of a portrait photo", async () => {
    await resolveUploadable({
      uri: "file:///IMG_0003.HEIC",
      fileName: "IMG_0003.HEIC",
      mimeType: "image/heic",
      width: 3024,
      height: 4032,
    });

    expect(lastContext().resize).toHaveBeenCalledWith({
      height: PHOTO_MAX_EDGE,
    });
  });

  it("re-encodes a large JPEG of unknown size, but leaves a small one alone", async () => {
    await resolveUploadable({
      uri: "file:///big.jpg",
      fileName: "big.jpg",
      mimeType: "image/jpeg",
      fileSize: 3 * 1024 * 1024,
    });
    expect(manipulator.manipulate).toHaveBeenCalledTimes(1);
    expect(lastContext().resize).not.toHaveBeenCalled();

    const small = await resolveUploadable({
      uri: "file:///small.jpg",
      fileName: "small.jpg",
      mimeType: "image/jpeg",
      width: 1200,
      height: 900,
      fileSize: 300 * 1024,
    });
    expect(manipulator.manipulate).toHaveBeenCalledTimes(1);
    expect(small.uri).toBe("file:///small.jpg");
  });

  it("never shrinks a PNG, whatever its size", async () => {
    const result = await resolveUploadable({
      uri: "file:///scan.png",
      fileName: "scan.png",
      mimeType: "image/png",
      width: 5000,
      height: 7000,
      fileSize: 20 * 1024 * 1024,
    });

    expect(manipulator.manipulate).not.toHaveBeenCalled();
    expect(result.uri).toBe("file:///scan.png");
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
    picked({
      uri: "file:///gone.jpg",
      fileName: "gone.jpg",
      mimeType: "image/jpeg",
    });
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
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
    } as never);

    const result = await pickAndUploadPhoto("channel-1", vi.fn());

    expect(result).toEqual({ status: "cancelled" });
  });

  it("refuses an oversized photo before spending a request", async () => {
    // Gate before minting: a 40 MB pick should cost no round trip and read as
    // a sentence, not as the bucket's raw non-JSON 400.
    grantedLibrary();
    picked({
      uri: "file:///big.jpg",
      fileName: "big.jpg",
      mimeType: "image/jpeg",
    });
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

  it("mints with, and claims, the real non-ASCII name; only the key is squashed (#2783)", async () => {
    // Web sends `file.name` untouched. Mobile used to squash it client-side,
    // which was load-bearing until the API built keys with
    // `safeObjectFilename` (#2697): every reader then saw `Caf_.jpg`.
    grantedLibrary();
    picked({
      uri: "file:///var/tmp/ABC-123.jpg",
      fileName: "Café.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });
    const requestUploadUrl = vi.fn().mockResolvedValue({
      upload_url: "https://storage.example/put",
      storage_path: "chapters/c/chat/ch/m/Caf_.jpg",
    });

    const result = await pickAndUploadPhoto("channel-1", requestUploadUrl);

    expect(requestUploadUrl).toHaveBeenCalledWith({
      id: "channel-1",
      body: {
        filename: "Café.jpg",
        content_type: "image/jpeg",
        size_bytes: 2048,
      },
    });
    expect(result).toEqual({
      status: "attached",
      attachment: {
        storagePath: "chapters/c/chat/ch/m/Caf_.jpg",
        filename: "Café.jpg",
        contentType: "image/jpeg",
        byteSize: 2048,
        width: null,
        height: null,
        thumbhash: null,
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
        // Not the default background session, which iOS runs slowly.
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      }),
    );
    expect(result).toEqual({
      status: "attached",
      attachment: {
        storagePath: "chapters/c/chat/m/photo.jpg",
        filename: "photo.jpg",
        contentType: "image/jpeg",
        byteSize: 2048,
        width: null,
        height: null,
        thumbhash: null,
      },
    });
  });

  it("uploads the preview copy beside the photo and claims it with the size and placeholder", async () => {
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });
    describePhoto.mockResolvedValue({
      width: 2560,
      height: 1920,
      thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j3A",
      previewUri: "file:///preview.jpg",
    });
    const requestUploadUrl = vi.fn().mockResolvedValue({
      ...TICKET,
      preview_upload_url: "https://storage.example/put-preview",
      preview_storage_path: "chapters/c/chat/m/preview/preview.jpg",
    });

    const result = await pickAndUploadPhoto("channel-1", requestUploadUrl);

    expect(requestUploadUrl).toHaveBeenCalledWith({
      id: "channel-1",
      body: expect.objectContaining({ with_preview: true }),
    });
    expect(fs.uploadAsync).toHaveBeenCalledWith(
      "https://storage.example/put-preview",
      "file:///preview.jpg",
      expect.objectContaining({ headers: { "Content-Type": "image/jpeg" } }),
    );
    expect(result).toEqual({
      status: "attached",
      attachment: expect.objectContaining({
        storagePath: "chapters/c/chat/m/photo.jpg",
        previewStoragePath: "chapters/c/chat/m/preview/preview.jpg",
        width: 2560,
        height: 1920,
        thumbhash: "3OcRJYB4d3h/iIeHeEh3eIhw+j3A",
      }),
    });
  });

  it("still sends the photo, without a preview, when only the preview PUT fails", async () => {
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });
    describePhoto.mockResolvedValue({
      ...NOT_DESCRIBED,
      previewUri: "file:///preview.jpg",
    });
    fs.uploadAsync.mockImplementation((async (url: string) => ({
      status: url.endsWith("put-preview") ? 500 : 200,
    })) as never);

    const result = await pickAndUploadPhoto(
      "channel-1",
      vi.fn().mockResolvedValue({
        ...TICKET,
        preview_upload_url: "https://storage.example/put-preview",
        preview_storage_path: "chapters/c/chat/m/preview/preview.jpg",
      }),
    );

    expect(result).toMatchObject({ status: "attached" });
    expect(
      result.status === "attached" && result.attachment.previewStoragePath,
    ).toBeUndefined();
  });

  it("asks for no preview upload when the photo needs none", async () => {
    grantedLibrary();
    picked({
      uri: "file:///photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileSize: 2048,
    });
    const requestUploadUrl = vi.fn().mockResolvedValue(TICKET);

    await pickAndUploadPhoto("channel-1", requestUploadUrl);

    expect(requestUploadUrl.mock.calls[0]![0].body).not.toHaveProperty(
      "with_preview",
    );
    expect(fs.uploadAsync).toHaveBeenCalledTimes(1);
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

describe("uploadFailureReason", () => {
  it("words a thrown 4xx body through the shared map, never its field names", () => {
    expect(
      uploadFailureReason({
        statusCode: 400,
        message: 'Content type "image/tiff" is not allowed',
      }),
    ).toBe("That file type isn't supported.");
    // class-validator answers with a list, written for a developer.
    expect(
      uploadFailureReason({
        statusCode: 400,
        message: ["filename must be a string", "content_type is not allowed"],
      }),
    ).not.toMatch(/filename|content_type/);
  });

  it.each([
    [
      "a 500's framework text",
      { statusCode: 500, message: "Internal server error" },
    ],
    ["a body with no status", { message: "something" }],
    [
      "a native Error, which is platform jargon",
      new Error("NSURLErrorDomain -1009"),
    ],
    ["nothing at all", undefined],
  ])("shows the generic sentence for %s", (_label, err) => {
    expect(uploadFailureReason(err)).toBe(
      "Couldn't upload that photo. Try again in a moment.",
    );
  });

  it("tells a member to wait a minute after a 429, whatever its body says", () => {
    expect(
      uploadFailureReason({ statusCode: 429, message: "Too Many Requests" }),
    ).toBe("Too many requests in a short time. Wait a minute, then try again.");
  });

  it("reaches the chat composer too: a refused mint reads as the API's reason", async () => {
    vi.mocked(
      ImagePicker,
    ).requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    } as never);
    vi.mocked(ImagePicker).launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///p.png", fileName: "p.png", mimeType: "image/png" },
      ],
    } as never);

    const result = await pickAndUploadPhoto(
      "channel-1",
      vi.fn().mockRejectedValue({
        statusCode: 403,
        message: "You do not have access to this channel",
      }),
    );

    expect(result).toEqual({
      status: "refused",
      reason: "You don't have access to this channel.",
    });
  });

  it("never crops a chat attachment: that re-encodes and drops GIF frames", async () => {
    vi.mocked(
      ImagePicker,
    ).requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    } as never);

    await pickAndUploadPhoto("channel-1", vi.fn());

    const [options] = vi.mocked(ImagePicker).launchImageLibraryAsync.mock
      .calls[0] as [Record<string, unknown>];
    expect(options).not.toHaveProperty("allowsEditing");
    expect(options).not.toHaveProperty("aspect");
  });
});

describe("pickChatPhotos", () => {
  it("opens the library for several photos, in the order tapped", async () => {
    grantedLibrary();
    picked({ uri: "file:///a.jpg", width: 3024, height: 4032 });

    await pickChatPhotos();

    const [options] = picker.launchImageLibraryAsync.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      allowsMultipleSelection: true,
      selectionLimit: CHAT_PHOTO_LIMIT,
      orderedSelection: true,
    });
  });

  it("asks only for the room left in the tray", async () => {
    grantedLibrary();
    picked({ uri: "file:///a.jpg" });
    await pickChatPhotos(3);
    const [options] = picker.launchImageLibraryAsync.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({ selectionLimit: 3 });
  });

  it("hands back the picker's own file to draw, and uploads nothing yet", async () => {
    grantedLibrary();
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///a.HEIC", width: 3024, height: 4032 },
        { uri: "file:///b.jpg", width: 0, height: 0 },
      ],
    } as never);

    const result = await pickChatPhotos();

    expect(result.status).toBe("picked");
    if (result.status !== "picked") return;
    expect(
      result.photos.map(({ previewUri, width, height }) => ({
        previewUri,
        width,
        height,
      })),
    ).toEqual([
      { previewUri: "file:///a.HEIC", width: 3024, height: 4032 },
      // A size the picker could not read is unknown, not zero.
      { previewUri: "file:///b.jpg", width: null, height: null },
    ]);
    expect(fs.uploadAsync).not.toHaveBeenCalled();
    expect(manipulator.manipulate).not.toHaveBeenCalled();
  });

  it("reads a picker that throws as a sentence, never a rejection", async () => {
    grantedLibrary();
    picker.launchImageLibraryAsync.mockRejectedValue(new Error("busy"));
    const result = await pickChatPhotos();
    expect(result.status).toBe("refused");
  });
});
