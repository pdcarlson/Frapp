import { describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  ZipTooLargeError,
  buildBackworkZip,
  zipEntryNames,
} from "./backwork-zip";

describe("zipEntryNames", () => {
  it("adds the stored file's extension, once", () => {
    expect(
      zipEntryNames([
        { title: "Exam 1", storagePath: "c/a.pdf" },
        { title: "Notes.DOCX", storagePath: "c/b.docx" },
        { title: "Scan", storagePath: "c/no-extension" },
      ]),
    ).toEqual(["Exam 1.pdf", "Notes.docx", "Scan"]);
  });

  it("numbers titles that collide, ignoring case", () => {
    expect(
      zipEntryNames([
        { title: "Exam 1", storagePath: "c/a.pdf" },
        { title: "exam 1", storagePath: "c/b.pdf" },
        { title: "Exam 1", storagePath: "c/c.pdf" },
      ]),
    ).toEqual(["Exam 1.pdf", "exam 1 (2).pdf", "Exam 1 (3).pdf"]);
  });

  it("makes a title safe for every file system", () => {
    expect(
      zipEntryNames([
        { title: 'CS/1200: "Final"?.', storagePath: "c/a.pdf" },
        { title: "  ", storagePath: "c/b.pdf" },
        { title: "CON", storagePath: "c/c.pdf" },
        { title: "Scan", storagePath: "chapter.v1/no-extension" },
      ]),
    ).toEqual(["CS 1200 Final.pdf", "Untitled.pdf", "CON file.pdf", "Scan"]);
  });
});

function fakeFetch(files: Record<string, { body: string; declared?: number; status?: number }>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const file = files[String(url)];
    if (!file) throw new TypeError("network down");
    const headers = new Headers();
    if (file.declared !== undefined) headers.set("content-length", String(file.declared));
    return new Response(file.body, { status: file.status ?? 200, headers });
  }) as unknown as typeof fetch;
}

async function entriesOf(blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(
    Object.entries(files).map(([name, data]) => [name, strFromU8(data)]),
  );
}

describe("buildBackworkZip", () => {
  it("zips each file under its name, in order, and reports progress", async () => {
    const onProgress = vi.fn();
    const result = await buildBackworkZip(
      [
        { name: "a.pdf", url: "u/a" },
        { name: "b.pdf", url: "u/b" },
      ],
      { fetcher: fakeFetch({ "u/a": { body: "AAA" }, "u/b": { body: "BB" } }), onProgress },
    );

    expect(await entriesOf(result.blob)).toEqual({ "a.pdf": "AAA", "b.pdf": "BB" });
    expect(result).toMatchObject({ added: 2, missed: 0 });
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it("counts files it couldn't get and zips the rest", async () => {
    const result = await buildBackworkZip(
      [
        { name: "a.pdf", url: "u/a" },
        { name: "gone.pdf", url: "u/gone" },
        { name: "refused.pdf", url: "u/refused" },
        { name: "unsigned.pdf", url: null },
      ],
      {
        fetcher: fakeFetch({ "u/a": { body: "AAA" }, "u/refused": { body: "", status: 403 } }),
      },
    );

    expect(await entriesOf(result.blob)).toEqual({ "a.pdf": "AAA" });
    expect(result).toMatchObject({ added: 1, missed: 3 });
  });

  it("fails when no file could be fetched", async () => {
    await expect(
      buildBackworkZip([{ name: "a.pdf", url: "u/a" }], { fetcher: fakeFetch({}) }),
    ).rejects.toThrow("None of the files");
  });

  it("stops at the size cap from the declared length, before reading the body", async () => {
    const fetcher = fakeFetch({
      "u/a": { body: "AAAA", declared: 4 },
      "u/b": { body: "BBBB", declared: 4 },
    });
    await expect(
      buildBackworkZip(
        [
          { name: "a.pdf", url: "u/a" },
          { name: "b.pdf", url: "u/b" },
        ],
        { fetcher, maxBytes: 6 },
      ),
    ).rejects.toBeInstanceOf(ZipTooLargeError);
  });

  it("stops at the size cap on bytes read when no length is declared", async () => {
    await expect(
      buildBackworkZip(
        [
          { name: "a.pdf", url: "u/a" },
          { name: "b.pdf", url: "u/b" },
        ],
        { fetcher: fakeFetch({ "u/a": { body: "AAAA" }, "u/b": { body: "BBBB" } }), maxBytes: 6 },
      ),
    ).rejects.toBeInstanceOf(ZipTooLargeError);
  });

  it("stops when the member leaves", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildBackworkZip([{ name: "a.pdf", url: "u/a" }], {
        fetcher: fakeFetch({ "u/a": { body: "A" } }),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
