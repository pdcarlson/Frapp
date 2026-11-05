import { describe, expect, it, vi } from "vitest";
import { MAX_BACKWORK_UPLOAD_BYTES } from "@repo/validation";
import { EMPTY_FIELDS, type BulkFields } from "./fields";
import { finishUpload, sha256Hex, type FinishDeps } from "./finish";
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
) {
  await finishUpload(
    {
      file: new File([ORIGINAL as BlobPart], "exam.pdf", { type: "application/pdf" }),
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
        title: "exam.pdf",
        department_code: "CSCI",
        year: 2024,
        semester: "Fall",
        assignment_type: undefined,
        assignment_number: undefined,
        tags: ["curved", "rubric"],
      }),
    );
  });
});
