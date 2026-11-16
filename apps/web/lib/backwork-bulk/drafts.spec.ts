import { describe, expect, it } from "vitest";
import { MAX_BACKWORK_DRAFT_BATCH } from "@repo/validation";
import type { BackworkDraft } from "@repo/hooks";
import { cellPatch, cellText, chunkIds, draftLabel, publishBlocker } from "./drafts";

const draft = (overrides: Partial<BackworkDraft> = {}): BackworkDraft => ({
  id: "d1",
  storage_path: "chapters/c/backwork/d1/Midterm-2.pdf",
  is_redacted: true,
  created_at: "2026-11-16T00:00:00Z",
  draft_fields: {},
  ...overrides,
});

describe("backwork draft cells (#5208)", () => {
  it("reads a stored value as text, and a missing one as blank", () => {
    const row = draft({ draft_fields: { year: 2024, semester: "Fall" } });
    expect(cellText(row, "year")).toBe("2024");
    expect(cellText(row, "semester")).toBe("Fall");
    expect(cellText(row, "professor_name")).toBe("");
  });

  it("clears a field when the text is blank", () => {
    expect(cellPatch("professor_name", "   ")).toEqual({ professor_name: null });
    expect(cellPatch("year", "")).toEqual({ year: null });
  });

  it("parses whole numbers and refuses what the API would", () => {
    expect(cellPatch("year", " 2024 ")).toEqual({ year: 2024 });
    expect(cellPatch("year", "1899")).toBeUndefined();
    expect(cellPatch("year", "20.5")).toBeUndefined();
    expect(cellPatch("assignment_number", "0")).toBeUndefined();
    expect(cellPatch("assignment_number", "3")).toEqual({ assignment_number: 3 });
    // The upper bounds too: a typo here would otherwise come back as a 400.
    expect(cellPatch("year", "20245")).toBeUndefined();
    expect(cellPatch("assignment_number", "9999999999")).toBeUndefined();
  });

  it("refuses text longer than the API takes", () => {
    expect(cellPatch("department_code", "C".repeat(21))).toBeUndefined();
    expect(cellPatch("department_code", "C".repeat(20))).toEqual({ department_code: "C".repeat(20) });
    expect(cellPatch("title", "t".repeat(256))).toBeUndefined();
  });

  it("takes only a choice on the list", () => {
    expect(cellPatch("semester", "Fall")).toEqual({ semester: "Fall" });
    expect(cellPatch("semester", "Autumn")).toBeUndefined();
    expect(cellPatch("document_variant", "Answer Key")).toEqual({ document_variant: "Answer Key" });
  });

  it("keeps text as typed, trimmed", () => {
    expect(cellPatch("department_code", " csci ")).toEqual({ department_code: "csci" });
  });

  it("holds back an as-is upload marked Student Copy, and only that", () => {
    expect(
      publishBlocker(draft({ is_redacted: false, draft_fields: { document_variant: "Student Copy" } })),
    ).toMatch(/Student Copy/);
    expect(publishBlocker(draft({ draft_fields: { document_variant: "Student Copy" } }))).toBeNull();
    expect(
      publishBlocker(draft({ is_redacted: false, draft_fields: { document_variant: "Blank Copy" } })),
    ).toBeNull();
  });

  it("labels a row by its title, else by its stored file name", () => {
    expect(draftLabel(draft({ draft_fields: { title: " Final " } }))).toBe("Final");
    expect(draftLabel(draft())).toBe("Midterm-2.pdf");
  });

  it("splits a big selection into calls the API takes", () => {
    const ids = Array.from({ length: MAX_BACKWORK_DRAFT_BATCH * 2 + 1 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([MAX_BACKWORK_DRAFT_BATCH, MAX_BACKWORK_DRAFT_BATCH, 1]);
    expect(chunks.flat()).toEqual(ids);
  });
});
