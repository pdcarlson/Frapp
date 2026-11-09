import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { documentQuery, mockSignedLinks, mockToast, pdf, assign } = vi.hoisted(() => ({
  documentQuery: {
    data: undefined as unknown,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  mockSignedLinks: vi.fn(),
  mockToast: vi.fn(),
  pdf: {
    loadPdf: vi.fn(),
    renderPagePreview: vi.fn(),
    destroyPdf: vi.fn().mockResolvedValue(undefined),
  },
  assign: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useDocument: () => documentQuery,
  useDocumentDownloadUrl: () => ({ mutateAsync: mockSignedLinks }),
}));
vi.mock("@/lib/backwork-bulk/pdf", () => pdf);
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

// jsdom's `location.assign` navigates and can't be spied on; the same stand-in
// `segment-error.spec.tsx` makes.
const realLocation = window.location;
Object.defineProperty(window, "location", {
  value: { ...realLocation, assign },
  configurable: true,
});
afterAll(() => {
  Object.defineProperty(window, "location", { value: realLocation, configurable: true });
});

const { DocumentViewer, previewKind, MAX_PREVIEW_PAGES } = await import("./document-viewer");

type Doc = Parameters<typeof previewKind>[0] & Record<string, unknown>;

function doc(id: string, title: string, content_type: string | null, storage_path = `c/documents/${id}/file`): Doc {
  return {
    id,
    chapter_id: "chap-1",
    title,
    description: null,
    folder: "Governance",
    storage_path,
    uploaded_by: "u-1",
    created_at: "2026-08-01T00:00:00Z",
    content_type,
    byte_size: null,
    document_type: null,
    effective_date: null,
  };
}

const BYLAWS = doc("d-1", "Chapter bylaws", "application/pdf");
const PHOTO = doc("d-2", "House photo", "image/jpeg");
const BUDGET = doc(
  "d-3",
  "Fall budget",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
);
const LIST = [BYLAWS, PHOTO, BUDGET] as never[];

function Harness({ initial }: { initial: string }) {
  // A tiny host, as the page is: the viewer holds no state of its own.
  const [openId, setOpenId] = useState<string | null>(initial);
  return <DocumentViewer documents={LIST} openId={openId} onOpenChange={setOpenId} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  documentQuery.data = undefined;
  documentQuery.isError = false;
  documentQuery.error = null;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  }) as never;
  pdf.loadPdf.mockResolvedValue({ numPages: 2 });
  pdf.renderPagePreview.mockImplementation((_doc: unknown, n: number) =>
    Promise.resolve({ url: `blob:page-${n}`, width: 612, height: 792 }),
  );
});

describe("previewKind", () => {
  it("previews PDFs and chat's raster images, and nothing else", () => {
    expect(previewKind(BYLAWS)).toBe("pdf");
    expect(previewKind(PHOTO)).toBe("image");
    expect(previewKind(doc("x", "x", "image/png; charset=binary"))).toBe("image");
    expect(previewKind(BUDGET)).toBe("none");
    expect(previewKind(doc("x", "x", "text/plain"))).toBe("none");
    // SVG isn't uploadable, and wouldn't preview if it were: chat's list.
    expect(previewKind(doc("x", "x", "image/svg+xml"))).toBe("none");
  });

  it("falls back to the stored extension only when no type was recorded", () => {
    expect(previewKind(doc("x", "x", null, "c/documents/x/minutes.pdf"))).toBe("pdf");
    expect(previewKind(doc("x", "x", null, "c/documents/x/minutes.docx"))).toBe("none");
  });
});

describe("DocumentViewer", () => {
  it("draws a PDF's pages from the inline link, page by page", async () => {
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/inline" };
    render(<Harness initial="d-1" />);

    const viewer = screen.getByRole("dialog", { name: "Chapter bylaws" });
    // Drawn top-left; the description reads it too, before the step hint.
    expect(within(viewer).getByText(/^PDF · Uploaded .* · Governance$/)).toBeVisible();
    expect(viewer).toHaveAccessibleDescription(/^PDF · Uploaded .* · Governance File 1 of 3\./);
    expect(
      await within(viewer).findByRole("img", { name: "Chapter bylaws, page 2 of 2" }),
    ).toHaveAttribute("src", "blob:page-2");
    expect(globalThis.fetch).toHaveBeenCalledWith("https://signed/inline");
  });

  it("stops at the page cap and offers the download for the rest", async () => {
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/inline" };
    pdf.loadPdf.mockResolvedValue({ numPages: MAX_PREVIEW_PAGES + 5 });
    render(<Harness initial="d-1" />);

    expect(
      await screen.findByText(`Showing the first ${MAX_PREVIEW_PAGES} of ${MAX_PREVIEW_PAGES + 5} pages.`),
    ).toBeInTheDocument();
    expect(pdf.renderPagePreview).toHaveBeenCalledTimes(MAX_PREVIEW_PAGES);
  });

  it("says when a PDF can't be drawn, and tries again on request", async () => {
    const user = userEvent.setup();
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/inline" };
    pdf.loadPdf.mockRejectedValueOnce(new Error("bad pdf"));
    render(<Harness initial="d-1" />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(documentQuery.refetch).toHaveBeenCalled();
    expect(await screen.findByRole("img", { name: /page 1 of 2/ })).toBeInTheDocument();
  });

  it("draws a photo in an image, never as a page", () => {
    documentQuery.data = { ...PHOTO, downloadUrl: "https://signed/photo" };
    render(<Harness initial="d-2" />);

    expect(screen.getByRole("img", { name: "House photo" })).toHaveAttribute(
      "src",
      "https://signed/photo",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("offers an Office file as a download, and saves it through the forced link", async () => {
    const user = userEvent.setup();
    mockSignedLinks.mockResolvedValue({
      ...BUDGET,
      downloadUrl: "https://signed/inline",
      forcedDownloadUrl: "https://signed/attachment",
    });
    render(<Harness initial="d-3" />);

    const viewer = screen.getByRole("dialog", { name: "Fall budget" });
    expect(
      within(viewer).getByText("Excel spreadsheets can't be previewed yet."),
    ).toBeInTheDocument();
    await user.click(within(viewer).getAllByRole("button", { name: "Download" })[1]!);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://signed/attachment"));
    expect(mockSignedLinks).toHaveBeenCalledWith("d-3");
  });

  it("steps through the list in order with the arrow keys, wrapping at the ends", async () => {
    const user = userEvent.setup();
    render(<Harness initial="d-1" />);

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "Fall budget" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "Chapter bylaws" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next file" }));
    expect(screen.getByRole("dialog", { name: "House photo" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("says a load failed rather than loading forever", () => {
    documentQuery.isError = true;
    documentQuery.error = new Error("offline");
    render(<Harness initial="d-1" />);

    expect(screen.getByText("Couldn't load this preview.")).toBeInTheDocument();
  });
});
