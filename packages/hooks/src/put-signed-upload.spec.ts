import { afterEach, describe, expect, it, vi } from "vitest";
import { putSignedUpload, SignedUploadError } from "./put-signed-upload";

const SIGNED_URL = "https://storage.example/object/upload/sign/doc.pdf?token=t";

function stubFetch(response: { ok: boolean; status: number }) {
  const fetchMock = vi.fn(async () => response as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("putSignedUpload", () => {
  it("PUTs the body with the caller's content type, not the file's own", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 });
    // An empty `type` is what a browser reports for a legacy .doc; the bucket
    // allowlist rejects it, so the resolved type must win.
    const file = new File(["bytes"], "minutes.doc", { type: "" });

    await putSignedUpload({
      signedUrl: SIGNED_URL,
      body: file,
      contentType: "application/msword",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(SIGNED_URL, {
      method: "PUT",
      body: file,
      headers: { "content-type": "application/msword" },
    });
  });

  it("sends x-upsert only when asked", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200 });
    const file = new File(["bytes"], "proof.pdf", { type: "application/pdf" });

    await putSignedUpload({
      signedUrl: SIGNED_URL,
      body: file,
      contentType: "application/pdf",
      upsert: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(SIGNED_URL, {
      method: "PUT",
      body: file,
      headers: { "content-type": "application/pdf", "x-upsert": "true" },
    });
  });

  it("throws a SignedUploadError carrying the status on a non-2xx", async () => {
    stubFetch({ ok: false, status: 413 });

    const attempt = putSignedUpload({
      signedUrl: SIGNED_URL,
      body: new Blob(["bytes"]),
      contentType: "application/pdf",
    });

    await expect(attempt).rejects.toBeInstanceOf(SignedUploadError);
    await expect(attempt).rejects.toMatchObject({
      status: 413,
      message: "Upload failed (413)",
    });
  });

  it("uses the caller's wording for the rejection, since members read it", async () => {
    stubFetch({ ok: false, status: 400 });

    await expect(
      putSignedUpload({
        signedUrl: SIGNED_URL,
        body: new Blob(["bytes"]),
        contentType: "image/png",
        describeRejection: (status) => `Storage rejected upload (${status}).`,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Storage rejected upload (400).",
    });
  });

  it("lets a network failure through as fetch's own error", async () => {
    const offline = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw offline;
      }),
    );

    await expect(
      putSignedUpload({
        signedUrl: SIGNED_URL,
        body: new Blob(["bytes"]),
        contentType: "image/png",
      }),
    ).rejects.toBe(offline);
  });
});
