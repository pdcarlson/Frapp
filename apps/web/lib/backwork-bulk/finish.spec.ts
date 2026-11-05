import { describe, expect, it, vi } from "vitest";
import { MAX_BACKWORK_UPLOAD_BYTES } from "@repo/validation";
import { EMPTY_FIELDS, type BulkFields } from "./fields";
import { finishUpload, flattenedFileName, sha256Hex, type FinishDeps } from "./finish";
import type { BoxesByPage } from "./geometry";

/**
 * The finish step (#3499). The rule under test: for a Student Copy, or any
 * document with a box, the original bytes are never sent anywhere. Only the
 * flattened file is PUT, and only its hash and size reach the API.
 */
const ORIGINAL: Uint8Array = new TextEncoder().encode("%PDF-1.7 Jane Doe original");
const FLAT: Uint8Array = new TextEncoder().encode("%PDF-1.7 flattened");
const DOC = { doc: true };

/** Compared as text: jsdom's Blob hands back another realm's Uint8Array. */
async function bytesOf(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function harness(
  flatten: FinishDeps<typeof DOC>["flatten"] = vi.fn(async () => FLAT),
) {
  const put = vi.fn<FinishDeps<typeof DOC>["put"]>(async () => undefined);
  const deps: FinishDeps<typeof DOC> = {
    flatten,
    requestUpload: vi.fn(async () => ({
      upload_url: "https://storage.example/upload",
      storage_path: "chapters/c1/backwork/r1/exam.pdf",
    })),
    put,
    confirm: vi.fn(async () => ({})),
  };
  return { deps, put, flatten };
}

async function run(
  fields: Partial<BulkFields>,
  boxes: BoxesByPage,
  deps: FinishDeps<typeof DOC>,
  flatten = false,
  name = "exam.pdf",
) {
  await finishUpload(
    {
      file: new File([ORIGINAL as BlobPart], name, { type: "application/pdf" }),
      prepared: { bytes: ORIGINAL, hash: await sha256Hex(ORIGINAL), doc: DOC },
      submission: { fields: { ...EMPTY_FIELDS, ...fields }, boxes, flatten },
    },
    deps,
  );
}

describe("finishUpload", () => {
  it("never sends a Student Copy's original bytes or hash", async () => {
    const { deps, put } = harness();
    // Even with a stale `flatten: false` on the submission.
    await run({ document_variant: "Student Copy" }, {}, deps, false);

    const sent = await bytesOf(put.mock.calls[0]![0].body);
    expect(sent).toBe(text(FLAT));
    expect(deps.requestUpload).toHaveBeenCalledWith(
      expect.objectContaining({ size_bytes: FLAT.byteLength }),
    );
    expect(deps.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ file_hash: await sha256Hex(FLAT), is_redacted: true }),
    );
  });

  it("flattens any variant that has a box on it", async () => {
    const { deps, put, flatten } = harness();
    const boxes = { 2: [{ x: 1, y: 1, width: 40, height: 10 }] };
    await run({ document_variant: "Answer Key" }, boxes, deps);
    expect(flatten).toHaveBeenCalledWith(DOC, boxes);
    expect(await bytesOf(put.mock.calls[0]![0].body)).toBe(text(FLAT));
  });

  it("uploads an unboxed Blank Copy as the original", async () => {
    const { deps, put, flatten } = harness();
    await run({ document_variant: "Blank Copy" }, {}, deps);
    expect(flatten).not.toHaveBeenCalled();
    expect(await bytesOf(put.mock.calls[0]![0].body)).toBe(text(ORIGINAL));
    expect(deps.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ file_hash: await sha256Hex(ORIGINAL), is_redacted: false }),
    );
  });

  it("re-flattens smaller when the first pass is over the cap", async () => {
    const tooBig = { byteLength: MAX_BACKWORK_UPLOAD_BYTES + 1 } as Uint8Array;
    const flatten = vi.fn().mockResolvedValueOnce(tooBig).mockResolvedValueOnce(FLAT);
    const { deps, put } = harness(flatten);
    await run({ document_variant: "Student Copy" }, {}, deps);
    expect(flatten).toHaveBeenLastCalledWith(DOC, {}, { dpi: 110, quality: 0.7 });
    expect(await bytesOf(put.mock.calls[0]![0].body)).toBe(text(FLAT));
  });

  it("refuses, sending nothing, when even the smaller pass is over the cap", async () => {
    const tooBig = { byteLength: MAX_BACKWORK_UPLOAD_BYTES + 1 } as Uint8Array;
    const { deps, put } = harness(vi.fn(async () => tooBig));
    await expect(run({ document_variant: "Student Copy" }, {}, deps)).rejects.toThrow(
      /over 50 MB once flattened/,
    );
    expect(deps.requestUpload).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("maps the fields the person confirmed", async () => {
    const { deps } = harness();
    await run(
      {
        title: "  ",
        department_code: " CSCI ",
        year: "2024",
        semester: "Fall",
        assignment_type: "Not a type",
        assignment_number: "0",
        tags: "curved, , rubric",
      },
      {},
      deps,
    );
    expect(deps.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        // A blank title on a flattened copy never falls back to the filename.
        title: "Redacted backwork",
        department_code: "CSCI",
        year: 2024,
        semester: "Fall",
        assignment_type: undefined,
        assignment_number: undefined,
        tags: ["curved", "rubric"],
      }),
    );
  });

  it("never sends a Student Copy's original filename", async () => {
    const { deps } = harness();
    await run(
      { document_variant: "Student Copy", title: "CSCI 1200 Midterm 2" },
      {},
      deps,
      false,
      "smithj_661234567_Midterm2.pdf",
    );
    expect(deps.requestUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "CSCI-1200-Midterm-2.pdf" }),
    );
    const sent = JSON.stringify([
      (deps.requestUpload as ReturnType<typeof vi.fn>).mock.calls,
      (deps.confirm as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(sent).not.toContain("smithj");
    expect(flattenedFileName("  ")).toBe("backwork.pdf");
  });

  it("waits out the upload-url rate limit instead of failing", async () => {
    const { deps } = harness();
    const limited = Object.assign(new Error("Too many requests"), { statusCode: 429 });
    const signed = { upload_url: "https://storage.example/u", storage_path: "chapters/c1/backwork/r/x.pdf" };
    deps.requestUpload = vi
      .fn()
      .mockRejectedValueOnce(limited)
      .mockRejectedValueOnce(limited)
      .mockResolvedValueOnce(signed);
    deps.sleep = vi.fn(async () => undefined);
    await run({ document_variant: "Blank Copy" }, {}, deps);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.confirm).toHaveBeenCalled();
  });

  it("only waits out a 429, and fails anything else at once", async () => {
    const { deps } = harness();
    const conflict = Object.assign(new Error("Conflict"), { statusCode: 409 });
    deps.requestUpload = vi.fn().mockRejectedValue(conflict);
    deps.sleep = vi.fn(async () => undefined);
    await expect(run({ document_variant: "Blank Copy" }, {}, deps)).rejects.toBe(conflict);
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.requestUpload).toHaveBeenCalledTimes(1);
  });

  it("gives up after three waits on the rate limit", async () => {
    const { deps, put } = harness();
    const limited = Object.assign(new Error("Too many requests"), { statusCode: 429 });
    deps.requestUpload = vi.fn().mockRejectedValue(limited);
    deps.sleep = vi.fn(async () => undefined);
    await expect(run({ document_variant: "Blank Copy" }, {}, deps)).rejects.toBe(limited);
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.requestUpload).toHaveBeenCalledTimes(4);
    expect(put).not.toHaveBeenCalled();
  });

  it("asks for no upload slot once the chapter has changed", async () => {
    const { deps, put } = harness();
    deps.assertChapter = () => {
      throw new Error("You switched chapters.");
    };
    await expect(run({ document_variant: "Blank Copy" }, {}, deps)).rejects.toThrow(
      /switched chapters/,
    );
    expect(deps.requestUpload).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("stops before filing anything once the chapter has changed", async () => {
    const { deps, put } = harness();
    let active = "c1";
    deps.assertChapter = () => {
      if (active !== "c1") throw new Error("You switched chapters.");
    };
    deps.put = vi.fn(async (input) => {
      await put(input);
      active = "c2";
    });
    await expect(run({ document_variant: "Blank Copy" }, {}, deps)).rejects.toThrow(
      /switched chapters/,
    );
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});

describe("flattenedFileName", () => {
  it("keeps only safe characters and trims the edges", () => {
    expect(flattenedFileName("Café / Exam #2: Final?")).toBe("Cafe-Exam-2-Final.pdf");
    expect(flattenedFileName("..-Midterm-..")).toBe("Midterm.pdf");
    expect(flattenedFileName("x".repeat(120))).toBe(`${"x".repeat(80)}.pdf`);
  });
});
