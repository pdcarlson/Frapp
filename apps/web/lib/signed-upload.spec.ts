import { describe, expect, it } from "vitest";
import { MISSING_SIGNED_UPLOAD, readSignedUpload } from "./signed-upload";

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
