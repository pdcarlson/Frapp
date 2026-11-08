import { describe, expect, it } from "vitest";
import {
  MISSING_SIGNED_UPLOAD,
  readPreviewUpload,
  readSignedUpload,
} from "./signed-upload";

describe("readSignedUpload", () => {
  it("reads the snake_case upload-URL contract", () => {
    expect(
      readSignedUpload({
        upload_url: "https://storage.example/put",
        storage_path: "chapters/c/backwork/r/notes.pdf",
        resource_id: "r",
      }),
    ).toEqual({
      signedUrl: "https://storage.example/put",
      storagePath: "chapters/c/backwork/r/notes.pdf",
    });
  });

  it("rejects the camelCase service ticket (the staging backwork failure)", () => {
    // `BackworkService.requestUploadUrl` returns this shape. Passing it
    // through the controller without mapping is a 201 the dashboard treats
    // as empty — this test is what would have caught that before staging.
    expect(() =>
      readSignedUpload({
        signedUrl: "https://storage.example/put",
        storagePath: "chapters/c/backwork/r/notes.pdf",
        resourceId: "r",
      }),
    ).toThrow(MISSING_SIGNED_UPLOAD);
  });

  it("rejects a ticket missing the signed URL", () => {
    expect(() =>
      readSignedUpload({
        storage_path: "chapters/c/backwork/r/notes.pdf",
      }),
    ).toThrow(MISSING_SIGNED_UPLOAD);
  });

  it("rejects a ticket missing the storage path", () => {
    expect(() =>
      readSignedUpload({
        upload_url: "https://storage.example/put",
      }),
    ).toThrow(MISSING_SIGNED_UPLOAD);
  });

  it("rejects empty strings", () => {
    expect(() =>
      readSignedUpload({
        upload_url: "",
        storage_path: "chapters/c/backwork/r/notes.pdf",
      }),
    ).toThrow(MISSING_SIGNED_UPLOAD);
  });
});

describe("readPreviewUpload", () => {
  it("reads the preview half of a chat photo's ticket", () => {
    expect(
      readPreviewUpload({
        upload_url: "https://storage.example/put",
        storage_path: "chapters/c/chat/ch/m/IMG.jpg",
        preview_upload_url: "https://storage.example/put-preview",
        preview_storage_path: "chapters/c/chat/ch/m/preview/preview.jpg",
      }),
    ).toEqual({
      signedUrl: "https://storage.example/put-preview",
      storagePath: "chapters/c/chat/ch/m/preview/preview.jpg",
    });
  });

  it("answers null, not an error, for a ticket with no preview", () => {
    expect(
      readPreviewUpload({
        upload_url: "https://storage.example/put",
        storage_path: "chapters/c/chat/ch/m/IMG.jpg",
      }),
    ).toBeNull();
    expect(readPreviewUpload(null)).toBeNull();
    expect(
      readPreviewUpload({ preview_upload_url: "", preview_storage_path: "x" }),
    ).toBeNull();
  });
});
