import { describe, expect, it } from "vitest";
import type { ImportRow } from "./import-progress";
import { currentImport, importStage } from "./current-import";

const row = (id: string, status: string, created_at: string) =>
  ({ id, status, created_at }) as unknown as ImportRow;

describe("currentImport", () => {
  it("is the newest import that holds anything, past drafts and deleted ones", () => {
    const { current, lastDeleted } = currentImport([
      row("old", "purged", "2026-09-01T00:00:00Z"),
      row("kept", "completed", "2026-09-30T00:00:00Z"),
      row("left", "draft", "2026-10-02T00:00:00Z"),
    ]);
    expect(current?.id).toBe("kept");
    expect(lastDeleted).toBeNull();
  });

  it("is nothing once the import is deleted, and names the newest deleted one", () => {
    const { current, lastDeleted } = currentImport([
      row("first", "purged", "2026-09-01T00:00:00Z"),
      row("second", "purged", "2026-09-30T00:00:00Z"),
      row("left", "draft", "2026-10-02T00:00:00Z"),
    ]);
    expect(current).toBeNull();
    expect(lastDeleted?.id).toBe("second");
  });

  it("is nothing at all for a chapter that never imported", () => {
    expect(currentImport([])).toEqual({ current: null, lastDeleted: null });
  });
});

describe("importStage", () => {
  it.each([
    ["ready", "importing"],
    ["running", "importing"],
    ["purging", "deleting"],
    ["completed", "finished"],
    ["failed", "finished"],
    ["cancelled", "finished"],
  ])("puts a %s import on the %s page", (status, stage) => {
    expect(importStage(row("x", status, "2026-09-30T00:00:00Z"))).toBe(stage);
  });
});
