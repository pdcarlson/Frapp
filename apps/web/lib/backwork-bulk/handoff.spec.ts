import { describe, expect, it } from "vitest";
import {
  peekStagedBulkUpload,
  stageBulkUpload,
  takeStagedBulkUpload,
} from "./handoff";

describe("bulk upload hand-off", () => {
  const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });

  it("gives the staged files to one taker only", () => {
    stageBulkUpload({ files: [pdf], skipped: 0 });
    expect(peekStagedBulkUpload()?.files).toEqual([pdf]);
    expect(takeStagedBulkUpload()?.files).toEqual([pdf]);
    expect(takeStagedBulkUpload()).toBeNull();
  });

  it("keeps only the latest staging", () => {
    const other = new File(["%PDF"], "b.pdf", { type: "application/pdf" });
    stageBulkUpload({ files: [pdf], skipped: 0 });
    stageBulkUpload({ files: [other], skipped: 2 });
    expect(takeStagedBulkUpload()).toEqual({ files: [other], skipped: 2 });
  });
});
