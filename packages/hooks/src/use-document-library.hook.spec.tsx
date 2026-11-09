/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_DOCUMENT_FILTERS,
  type DocumentFilters,
  type LibrarySourceDocument,
} from "./document-library";
import { useDocumentLibrary } from "./use-document-library";

const doc = (
  id: string,
  title: string,
  uploaded_by: string,
  created_at: string,
  folder: string | null = null,
): LibrarySourceDocument => ({ id, title, uploaded_by, created_at, folder });

const DOCS = [
  doc("d1", "Bylaws", "u-ryan", "2026-08-01T12:00:00Z", "Governance"),
  doc("d2", "Budget", "u-ana", "2026-10-25T12:00:00Z"),
];

function render(
  props: Partial<Parameters<typeof useDocumentLibrary>[0]> & {
    filters?: DocumentFilters;
  } = {},
) {
  return renderHook(
    (next: Partial<Parameters<typeof useDocumentLibrary>[0]>) =>
      useDocumentLibrary({
        documents: DOCS,
        folder: null,
        search: "",
        filters: NO_DOCUMENT_FILTERS,
        sort: "name",
        namesById: { "u-ryan": "Ryan Castellano", "u-ana": "Ana Ruiz" },
        semesters: [],
        ...props,
        ...next,
      }),
    { initialProps: {} },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentLibrary (#3938)", () => {
  it("drops a picked uploader the roster no longer names", () => {
    const { result } = render({
      filters: { uploader: "u-gone", date: null },
    });
    expect(result.current.filters.uploader).toBeNull();
    expect(result.current.filtering).toBe(false);
    expect(result.current.visible).toHaveLength(2);
  });

  it("keeps a named pick, and its choice, after their last file goes", () => {
    const { result } = render({
      documents: [DOCS[1]!],
      filters: { uploader: "u-ryan", date: null },
    });
    expect(result.current.filters.uploader).toBe("u-ryan");
    expect(result.current.uploaders).toContainEqual({
      value: "u-ryan",
      label: "Ryan Castellano",
    });
    expect(result.current.visible).toEqual([]);
    expect(result.current.filtering).toBe(true);
  });

  it('reads "" as documents in no folder', () => {
    const { result } = render({ folder: "" });
    expect(result.current.visible.map((row) => row.doc.id)).toEqual(["d2"]);
    expect(result.current.folderTotal).toBe(1);
  });

  it("treats the semester as unknown until the archives load", () => {
    const { result } = render({
      semesters: undefined,
      filters: { uploader: null, date: { preset: "semester" } },
    });
    expect(result.current.semesterKnown).toBe(false);
    expect(result.current.filtering).toBe(false);
    expect(result.current.visible).toHaveLength(2);
  });

  it("moves Last 30 days with the clock, and holds it while paused", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    const filters: DocumentFilters = {
      uploader: null,
      date: { preset: "30d" },
    };
    const { result, rerender } = render({ filters });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.visible.map((row) => row.doc.id)).toEqual(["d2"]);

    rerender({ paused: true });
    act(() => {
      vi.setSystemTime(new Date("2026-11-30T12:00:00Z"));
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current.visible.map((row) => row.doc.id)).toEqual(["d2"]);

    rerender({ paused: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.visible).toEqual([]);
  });

  it("says when the response sat at the row cap", () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      doc(`d${i}`, `File ${i}`, "u-ana", "2026-10-01T00:00:00Z"),
    );
    expect(render({ documents: many }).result.current.truncated).toBe(true);
    expect(render().result.current.truncated).toBe(false);
  });
});
