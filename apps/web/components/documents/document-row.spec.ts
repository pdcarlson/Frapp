import { describe, expect, it } from "vitest";
import type { ChapterDocument } from "@/components/documents/document-types";
import { documentFacts } from "./document-row";

function doc(overrides: Partial<ChapterDocument>): ChapterDocument {
  return {
    title: "Bylaws",
    folder: null,
    document_type: null,
    description: null,
    created_at: "2026-11-16T15:00:00.000Z",
    effective_date: null,
    ...overrides,
  } as ChapterDocument;
}

describe("documentFacts", () => {
  it("leaves out an effective date that is the upload day (#5207)", () => {
    expect(
      documentFacts(doc({ effective_date: "2026-11-16" }), null).filed,
    ).toEqual([]);
  });

  it("names an effective date on another day", () => {
    expect(
      documentFacts(doc({ effective_date: "2026-09-01" }), null).filed,
    ).toEqual([expect.stringMatching(/^Effective /)]);
  });
});
