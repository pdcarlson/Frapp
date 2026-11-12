import { describe, expect, it, vi } from "vitest";
import {
  RESUMABLE_CHUNK_BYTES,
  ResumableUploadError,
  base64Utf8,
  blobSource,
  uploadResumable,
} from "./resumable-upload";

const TARGET = {
  bucket: "meeting-audio",
  path: "chapter/meeting/upload.m4a",
  token: "signed-token",
  contentType: "audio/mp4",
};
const OPTIONS = { supabaseUrl: "http://supabase.test/", sleep: () => Promise.resolve() };

/** A Storage that keeps count of what it has, as the real one does. */
function storage(fileSize: number) {
  let have = 0;
  const calls: { method: string; offset: string | null }[] = [];
  const fail: (Response | Error | "half")[] = [];
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    calls.push({ method, offset: headers.get("Upload-Offset") });
    // What the real server refuses a request without.
    if (headers.get("Tus-Resumable") !== "1.0.0") {
      return new Response(null, { status: 412 });
    }
    if (method === "POST") {
      const meta = headers.get("Upload-Metadata") ?? "";
      if (
        headers.get("x-signature") !== TARGET.token ||
        !meta.includes(`contentType ${btoa(TARGET.contentType)}`)
      ) {
        return new Response(null, { status: 400 });
      }
      return new Response(null, {
        status: 201,
        headers: { Location: "/storage/v1/upload/resumable/sign/abc" },
      });
    }
    if (method === "HEAD") {
      if (String(url).endsWith("/gone")) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 200,
        headers: { "Upload-Offset": String(have), "Upload-Length": String(fileSize) },
      });
    }
    if (headers.get("Content-Type") !== "application/offset+octet-stream") {
      return new Response(null, { status: 415 });
    }
    const planned = fail.shift();
    const body = init?.body as Blob;
    if (planned === "half") {
      // The connection dropped after part of the piece arrived.
      have += Math.floor(body.size / 2);
      throw new TypeError("network");
    }
    if (planned instanceof Error) throw planned;
    if (planned) return planned;
    if (Number(headers.get("Upload-Offset")) !== have) {
      return new Response(null, { status: 409 });
    }
    have += body.size;
    return new Response(null, {
      status: 204,
      headers: { "Upload-Offset": String(have) },
    });
  });
  return {
    send: send as unknown as typeof fetch,
    calls,
    fail,
    received: () => have,
    /** As if an earlier try had already delivered this much. */
    hold: (bytes: number) => {
      have = bytes;
    },
  };
}

const file = (bytes: number) => blobSource(new Blob([new Uint8Array(bytes)]));

describe("uploadResumable", () => {
  it("creates the upload with the signature, then sends it in six-megabyte pieces", async () => {
    const size = RESUMABLE_CHUNK_BYTES * 2 + 10;
    const server = storage(size);
    const progress: number[] = [];
    await uploadResumable(file(size), TARGET, {
      ...OPTIONS,
      fetch: server.send,
      onProgress: (sent) => progress.push(sent),
    });
    expect(server.received()).toBe(size);
    expect(server.calls.map((call) => call.method)).toEqual([
      "POST",
      "PATCH",
      "PATCH",
      "PATCH",
    ]);
    expect(progress).toEqual([
      0,
      RESUMABLE_CHUNK_BYTES,
      RESUMABLE_CHUNK_BYTES * 2,
      size,
    ]);
    const [url, init] = (server.send as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(url).toBe("http://supabase.test/storage/v1/upload/resumable/sign");
    const headers = new Headers(init.headers);
    expect(headers.get("x-signature")).toBe("signed-token");
    expect(headers.get("Upload-Length")).toBe(String(size));
    expect(headers.get("Upload-Metadata")).toContain(
      `bucketName ${btoa("meeting-audio")}`,
    );
    expect(headers.get("Upload-Metadata")).toContain(
      `objectName ${btoa(TARGET.path)}`,
    );
  });

  it("after a dropped connection, asks how much arrived and carries on from there", async () => {
    const size = RESUMABLE_CHUNK_BYTES + 100;
    const server = storage(size);
    server.fail.push("half");
    await uploadResumable(file(size), TARGET, { ...OPTIONS, fetch: server.send });
    expect(server.received()).toBe(size);
    expect(server.calls.slice(1, 4)).toEqual([
      { method: "PATCH", offset: "0" },
      { method: "HEAD", offset: null },
      { method: "PATCH", offset: String(RESUMABLE_CHUNK_BYTES / 2) },
    ]);
  });

  it("tries a piece again when Storage is briefly unwell", async () => {
    const server = storage(10);
    server.fail.push(new Response(null, { status: 503 }));
    await uploadResumable(file(10), TARGET, { ...OPTIONS, fetch: server.send });
    expect(server.received()).toBe(10);
  });

  it("takes Storage's count when it disagrees about how much has arrived", async () => {
    const size = RESUMABLE_CHUNK_BYTES + 100;
    const server = storage(size);
    server.fail.push(new Response(null, { status: 409 }));
    await uploadResumable(file(size), TARGET, { ...OPTIONS, fetch: server.send });
    expect(server.received()).toBe(size);
    expect(server.calls.slice(1, 4).map((call) => call.method)).toEqual([
      "PATCH",
      "HEAD",
      "PATCH",
    ]);
  });

  it("gives up as a network failure when the connection never comes back", async () => {
    const server = storage(10);
    for (let i = 0; i < 10; i += 1) server.fail.push(new TypeError("offline"));
    await expect(
      uploadResumable(file(10), TARGET, { ...OPTIONS, fetch: server.send }),
    ).rejects.toMatchObject({ failure: "network" });
  });

  it("reads Storage's refusals: too large, or rejected", async () => {
    const tooLarge = storage(10);
    tooLarge.fail.push(new Response(null, { status: 413 }));
    await expect(
      uploadResumable(file(10), TARGET, { ...OPTIONS, fetch: tooLarge.send }),
    ).rejects.toMatchObject({ failure: "too_large" });

    const refused = vi.fn(async () => new Response(null, { status: 403 }));
    const error = await uploadResumable(file(10), TARGET, {
      ...OPTIONS,
      fetch: refused as unknown as typeof fetch,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResumableUploadError);
    expect((error as ResumableUploadError).failure).toBe("rejected");
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("stops at once when the caller stops it", async () => {
    const server = storage(RESUMABLE_CHUNK_BYTES * 3);
    const controller = new AbortController();
    const stopped = uploadResumable(file(RESUMABLE_CHUNK_BYTES * 3), TARGET, {
      ...OPTIONS,
      fetch: server.send,
      signal: controller.signal,
      onProgress: (sent) => {
        if (sent > 0) controller.abort();
      },
    });
    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
    expect(server.received()).toBe(RESUMABLE_CHUNK_BYTES);
  });

  it("carries on an upload begun earlier from what Storage already holds", async () => {
    const size = RESUMABLE_CHUNK_BYTES * 2 + 10;
    const server = storage(size);
    server.hold(RESUMABLE_CHUNK_BYTES);
    const progress: number[] = [];
    const urls: string[] = [];
    await uploadResumable(file(size), TARGET, {
      ...OPTIONS,
      fetch: server.send,
      resumeUrl: "http://supabase.test/storage/v1/upload/resumable/sign/abc",
      onUploadUrl: (url) => urls.push(url),
      onProgress: (sent) => progress.push(sent),
    });
    expect(server.received()).toBe(size);
    // No new upload was created: Storage was asked, then sent the rest.
    expect(server.calls.map((call) => call.method)).toEqual([
      "HEAD",
      "PATCH",
      "PATCH",
    ]);
    expect(progress[0]).toBe(RESUMABLE_CHUNK_BYTES);
    expect(urls).toEqual([
      "http://supabase.test/storage/v1/upload/resumable/sign/abc",
    ]);
  });

  it("starts over when Storage no longer knows the earlier upload", async () => {
    const server = storage(10);
    const urls: string[] = [];
    await uploadResumable(file(10), TARGET, {
      ...OPTIONS,
      fetch: server.send,
      resumeUrl: "http://supabase.test/storage/v1/upload/resumable/sign/gone",
      onUploadUrl: (url) => urls.push(url),
    });
    expect(server.received()).toBe(10);
    expect(server.calls.map((call) => call.method)).toEqual([
      "HEAD",
      "POST",
      "PATCH",
    ]);
    expect(urls).toEqual([
      "http://supabase.test/storage/v1/upload/resumable/sign/abc",
    ]);
  });

  it("reads each piece from the source only when it is about to be sent", async () => {
    const size = RESUMABLE_CHUNK_BYTES + 5;
    const server = storage(size);
    const reads: [number, number][] = [];
    await uploadResumable(
      {
        size,
        read: async (from, to) => {
          reads.push([from, to]);
          return new Blob([new Uint8Array(to - from)]);
        },
      },
      TARGET,
      { ...OPTIONS, fetch: server.send },
    );
    expect(reads).toEqual([
      [0, RESUMABLE_CHUNK_BYTES],
      [RESUMABLE_CHUNK_BYTES, size],
    ]);
  });
});

describe("base64Utf8", () => {
  it("matches the platform's base64 for plain and accented text", () => {
    for (const value of ["", "a", "ab", "abc", "meeting-audio", "audio/aac"]) {
      expect(base64Utf8(value)).toBe(btoa(value));
    }
    expect(base64Utf8("Réunion é")).toBe(
      Buffer.from("Réunion é", "utf8").toString("base64"),
    );
  });
});
