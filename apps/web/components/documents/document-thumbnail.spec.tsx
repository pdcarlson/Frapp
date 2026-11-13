import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DocumentThumbnail,
  MAX_THUMBNAIL_BYTES,
  pdfThumbnail,
  resetThumbnailCachesForTest,
  thumbnailKind,
  type ThumbnailLink,
} from "@/components/documents/document-thumbnail";
import type { ChapterDocument } from "@/components/documents/document-types";

/**
 * #4647: a grid tile previews a photo or a PDF's first page, from the list's
 * batch of signed links, only once it nears the screen, and falls back to its
 * type glyph when it can't.
 */

const pdf = vi.hoisted(() => ({
  loadPdf: vi.fn(),
  destroyPdf: vi.fn(),
  renderPagePreview: vi.fn(),
}));
vi.mock("@/lib/backwork-bulk/pdf", () => pdf);

// IntersectionObserver that reports every observed node as on screen once
// `reveal()` is called, so a test controls when a tile "nears the screen".
let observed: Array<{
  node: Element;
  callback: IntersectionObserverCallback;
}> = [];
class FakeObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(node: Element) {
    observed.push({ node, callback: this.callback });
  }
  disconnect() {
    observed = observed.filter((o) => o.callback !== this.callback);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
function reveal() {
  act(() => {
    for (const { node, callback } of [...observed]) {
      callback(
        [{ isIntersecting: true, target: node } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
  });
}

const PHOTO: ChapterDocument = {
  id: "doc-photo",
  chapter_id: "chap-1",
  title: "Formal photo",
  description: null,
  folder: null,
  storage_path: "chap-1/formal.jpg",
  uploaded_by: "u-1",
  created_at: "2026-11-01T00:00:00Z",
  content_type: "image/jpeg",
  byte_size: 2_000_000,
  document_type: null,
  effective_date: null,
};
const BYLAWS: ChapterDocument = {
  ...PHOTO,
  id: "doc-pdf",
  title: "Bylaws",
  storage_path: "chap-1/bylaws.pdf",
  content_type: "application/pdf",
  byte_size: 40_000,
};

function tile(doc: ChapterDocument, link: ThumbnailLink) {
  const kind = doc.content_type === "application/pdf" ? "pdf" : "image";
  return (
    <DocumentThumbnail
      doc={doc}
      kind={kind}
      typeLabel={kind === "pdf" ? "PDF" : "Photo"}
      pinned={false}
      link={link}
    />
  );
}
const frame = (container: HTMLElement) =>
  container.querySelector("[data-thumbnail]")!;

beforeEach(() => {
  resetThumbnailCachesForTest();
  observed = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
  vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: vi.fn() }));
  pdf.loadPdf.mockReset().mockResolvedValue({ numPages: 3 });
  pdf.destroyPdf.mockReset().mockResolvedValue(undefined);
  let n = 0;
  pdf.renderPagePreview
    .mockReset()
    .mockImplementation(async () => ({ url: `blob:page-${++n}`, width: 1, height: 1 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("thumbnailKind", () => {
  it("previews photos and PDFs of a known size up to the cap", () => {
    expect(thumbnailKind(PHOTO)).toBe("image");
    expect(thumbnailKind(BYLAWS)).toBe("pdf");
    expect(thumbnailKind({ ...BYLAWS, byte_size: MAX_THUMBNAIL_BYTES })).toBe("pdf");
  });

  it("gives no preview past the cap, or when the size is unknown", () => {
    expect(thumbnailKind({ ...BYLAWS, byte_size: MAX_THUMBNAIL_BYTES + 1 })).toBe(
      "none",
    );
    expect(thumbnailKind({ ...PHOTO, byte_size: null })).toBe("none");
  });

  it("never previews Word or other files", () => {
    expect(
      thumbnailKind({
        ...PHOTO,
        storage_path: "chap-1/minutes.docx",
        content_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("none");
  });
});

describe("DocumentThumbnail, a photo", () => {
  it("loads nothing until the tile nears the screen, then draws the signed link", () => {
    const { container } = render(
      tile(PHOTO, { status: "ready", url: "https://signed/photo-1" }),
    );
    expect(container.querySelector("img")).toBeNull();
    reveal();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://signed/photo-1",
    );
  });

  it("keeps the link it loaded when a fresh one arrives, so the photo isn't downloaded again", () => {
    const { container, rerender } = render(
      tile(PHOTO, { status: "ready", url: "https://signed/photo-1" }),
    );
    reveal();
    fireEvent.load(container.querySelector("img")!);
    rerender(tile(PHOTO, { status: "ready", url: "https://signed/photo-2" }));
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://signed/photo-1",
    );
    // The kept link has expired: the fresh one takes over.
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://signed/photo-2",
    );
  });

  it("shows the type glyph when the photo won't load, and tries again with a fresh link", () => {
    const { container, rerender } = render(
      tile(PHOTO, { status: "ready", url: "https://signed/photo-1" }),
    );
    reveal();
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(frame(container)).toHaveTextContent("Photo");

    rerender(tile(PHOTO, { status: "ready", url: "https://signed/photo-2" }));
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://signed/photo-2",
    );
  });

  it("pulses while the link is signing, and shows the glyph if signing failed", () => {
    const { container, rerender } = render(tile(PHOTO, { status: "loading" }));
    reveal();
    expect(frame(container).className).toContain("animate-pulse");
    rerender(tile(PHOTO, { status: "error" }));
    expect(frame(container).className).not.toContain("animate-pulse");
    expect(frame(container)).toHaveTextContent("Photo");
    rerender(tile(PHOTO, { status: "ready", url: null }));
    expect(frame(container)).toHaveTextContent("Photo");
  });
});

describe("DocumentThumbnail, a PDF", () => {
  it("draws the first page once it nears the screen, and reuses it on a remount", async () => {
    const link = { status: "ready", url: "https://signed/bylaws" } as const;
    const first = render(tile(BYLAWS, link));
    expect(pdf.loadPdf).not.toHaveBeenCalled();
    reveal();
    expect(await screen.findByRole("presentation", { hidden: true })).toHaveAttribute(
      "src",
      "blob:page-1",
    );
    expect(pdf.renderPagePreview).toHaveBeenCalledWith(expect.anything(), 1, 320);
    expect(pdf.destroyPdf).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(tile(BYLAWS, { status: "ready", url: "https://signed/fresh" }));
    reveal();
    expect(await screen.findByRole("presentation", { hidden: true })).toHaveAttribute(
      "src",
      "blob:page-1",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("draws a page that failed to show once more, then falls back to the glyph", async () => {
    const { container } = render(
      tile(BYLAWS, { status: "ready", url: "https://signed/bylaws" }),
    );
    reveal();
    const img = await screen.findByRole("presentation", { hidden: true });
    expect(img).toHaveAttribute("src", "blob:page-1");
    fireEvent.error(img);
    const again = await screen.findByRole("presentation", { hidden: true });
    expect(again).toHaveAttribute("src", "blob:page-2");
    fireEvent.error(again);
    expect(container.querySelector("img")).toBeNull();
    expect(frame(container)).toHaveTextContent("PDF");
  });

  it("shows the glyph when the file won't load, and doesn't keep the failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    const { container } = render(
      tile(BYLAWS, { status: "ready", url: "https://signed/bylaws" }),
    );
    reveal();
    await vi.waitFor(() => expect(frame(container)).toHaveTextContent("PDF"));
    await expect(pdfThumbnail(BYLAWS.storage_path, "https://signed/bylaws")).resolves.toBe(
      "blob:page-1",
    );
  });

  it("draws at most two first pages at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    pdf.loadPdf.mockImplementation(async () => {
      await gate;
      return { numPages: 1 };
    });
    const pages = ["a", "b", "c"].map((name) =>
      pdfThumbnail(`chap-1/${name}.pdf`, `https://signed/${name}`),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    release();
    await Promise.all(pages);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("lets go of the least recently used drawn pages past 60, never one still drawing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    pdf.loadPdf.mockImplementationOnce(async () => {
      await gate;
      return { numPages: 1 };
    });
    // The first takes a slot and waits; the rest draw through the other one.
    const slow = pdfThumbnail("chap-1/slow.pdf", "https://signed/slow");
    for (let i = 0; i < 61; i += 1) {
      await pdfThumbnail(`chap-1/${i}.pdf`, `https://signed/${i}`);
    }
    // 62 asked for, one still drawing: the two oldest drawn pages went, not
    // the one still drawing.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:page-1");
    release();
    const slowSrc = await slow;
    // Back at the cap, nothing more goes, and the page that finished last
    // is kept.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(slowSrc);
    // Asking for the slow one again is a cache hit.
    const fetches = vi.mocked(fetch).mock.calls.length;
    await pdfThumbnail("chap-1/slow.pdf", "https://signed/slow");
    expect(fetch).toHaveBeenCalledTimes(fetches);
  });
});
