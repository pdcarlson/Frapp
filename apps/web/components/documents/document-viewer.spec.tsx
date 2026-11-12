import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { documentQuery, mockSignedLinks, mockToast, pdf, assign, useDocumentSpy } = vi.hoisted(() => ({
  documentQuery: {
    data: undefined as unknown,
    dataUpdatedAt: 0,
    isError: false,
    error: null as unknown,
    refetch: vi.fn().mockResolvedValue(undefined),
  },
  mockSignedLinks: vi.fn(),
  mockToast: vi.fn(),
  pdf: {
    loadPdf: vi.fn(),
    renderPagePreview: vi.fn(),
    destroyPdf: vi.fn().mockResolvedValue(undefined),
  },
  assign: vi.fn(),
  useDocumentSpy: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useDocument: (...args: unknown[]) => {
    useDocumentSpy(...args);
    return documentQuery;
  },
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

const { fileKind } = await import("@repo/hooks/document-library");
const { DocumentViewer, previewKind, MAX_PREVIEW_PAGES, OPEN_DOCUMENT_ATTRIBUTE } =
  await import("./document-viewer");
const { VIEWER_BACKDROP_ATTRIBUTE } = await import("@/components/shared/media-viewer");

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

function Harness({ initial, documents = LIST }: { initial: string; documents?: never[] }) {
  // A tiny host, as the page is: the viewer holds no state of its own. The
  // row buttons stand in for the list, for focus to return to.
  const [openId, setOpenId] = useState<string | null>(initial);
  return (
    <>
      {documents.map((d: { id: string; title: string }) => (
        <button key={d.id} type="button" {...{ [OPEN_DOCUMENT_ATTRIBUTE]: d.id }}>
          Row {d.title}
        </button>
      ))}
      <DocumentViewer documents={documents} openId={openId} onOpenChange={setOpenId} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  documentQuery.data = undefined;
  documentQuery.dataUpdatedAt = 0;
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

  it("falls back to the stored extension only when no useful type was recorded", () => {
    expect(previewKind(doc("x", "x", null, "c/documents/x/minutes.pdf"))).toBe("pdf");
    expect(previewKind(doc("x", "x", null, "c/documents/x/minutes.docx"))).toBe("none");
    // The declared type wins over the name, even an unrecognised one the
    // filter groups by its extension.
    expect(previewKind(doc("x", "x", "text/plain", "c/documents/x/minutes.pdf"))).toBe("none");
    const legacy = doc("x", "x", "application/x-pdf", "c/documents/x/minutes.pdf");
    expect(fileKind(legacy)).toBe("pdf");
    expect(previewKind(legacy)).toBe("none");
  });

  // #3959: the File type filter called this an Image while the viewer showed
  // a bare "File" card. Both now read `classifyFile`.
  it("previews an older row's photo the File type filter calls an Image", () => {
    const old = doc("x", "x", null, "c/documents/x/rush.JPG");
    expect(fileKind(old)).toBe("image");
    expect(previewKind(old)).toBe("image");
    const generic = doc("x", "x", "application/octet-stream", "c/documents/x/rush.png");
    expect(fileKind(generic)).toBe("image");
    expect(previewKind(generic)).toBe("image");
    // Grouped as an image, but not one a browser draws.
    expect(previewKind(doc("x", "x", null, "c/documents/x/logo.svg"))).toBe("none");
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
    // Nothing to draw, so no links were fetched until Download asked.
    expect(useDocumentSpy).toHaveBeenCalledWith("d-3", { enabled: false });
  });

  // #3959: the label comes from the classifier the filter uses, so an older
  // row the filter calls a Spreadsheet isn't a bare "File" here.
  it("names an untyped file by its stored extension, as the File type filter does", () => {
    const old = doc("d-9", "Spring budget", null, "c/documents/d-9/budget.xlsx");
    render(<Harness initial="d-9" documents={[old] as never[]} />);

    const viewer = screen.getByRole("dialog", { name: "Spring budget" });
    expect(
      within(viewer).getByText("Excel spreadsheets can't be previewed yet."),
    ).toBeInTheDocument();
    expect(within(viewer).getAllByText(/^Excel spreadsheet · Uploaded/).length).toBeGreaterThan(0);
  });

  it("calls an image it can't draw by its type, not a Photo", () => {
    const heic = doc("d-8", "Rush flyer", "image/heic");
    render(<Harness initial="d-8" documents={[heic] as never[]} />);

    const viewer = screen.getByRole("dialog", { name: "Rush flyer" });
    expect(within(viewer).getByText("HEIC photos can't be previewed yet.")).toBeInTheDocument();
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

  it("keeps one dialog while stepping, so the backdrop doesn't flash", async () => {
    const user = userEvent.setup();
    render(<Harness initial="d-1" />);
    const dialog = screen.getByRole("dialog");

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("dialog", { name: "House photo" })).toBe(dialog);
  });

  it("returns focus to the row of the document it was showing", async () => {
    const user = userEvent.setup();
    render(<Harness initial="d-1" />);

    await user.keyboard("{ArrowRight}{Escape}");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Row House photo" })).toHaveFocus(),
    );
  });

  it("closes when its row leaves the list", () => {
    const { rerender } = render(<Harness initial="d-3" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(<Harness initial="d-3" documents={[BYLAWS, PHOTO] as never[]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // And stays closed when the row comes back: the open id was cleared.
    rerender(<Harness initial="d-3" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a press beside a PDF's pages, but not on its scrollbar", async () => {
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/inline" };
    render(<Harness initial="d-1" />);
    await screen.findByRole("img", { name: /page 2 of 2/ });
    const column = screen
      .getByRole("dialog")
      .querySelector<HTMLElement>(`[${VIEWER_BACKDROP_ATTRIBUTE}]`)!;
    // jsdom lays nothing out: a 600px column whose scrollbar starts at 590.
    Object.defineProperty(column, "clientWidth", { value: 590 });
    Object.defineProperty(column, "clientHeight", { value: 800 });
    column.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;

    fireEvent.pointerDown(column, { button: 0, clientX: 595, clientY: 10 });
    fireEvent.pointerUp(column, { button: 0, clientX: 595, clientY: 10 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.pointerDown(column, { button: 0, clientX: 20, clientY: 10 });
    fireEvent.pointerUp(column, { button: 0, clientX: 20, clientY: 10 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the pages it drew when a refetch mints a new link", async () => {
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/first" };
    const { rerender } = render(<Harness initial="d-1" />);
    await screen.findByRole("img", { name: /page 2 of 2/ });

    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/second" };
    rerender(<Harness initial="d-1" />);

    expect(screen.getByRole("img", { name: /page 1 of 2/ })).toHaveAttribute(
      "src",
      "blob:page-1",
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("tears down a PDF that finishes loading after the viewer moved on", async () => {
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/inline" };
    let finish!: (doc: unknown) => void;
    pdf.loadPdf.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<Harness initial="d-1" />);
    await waitFor(() => expect(pdf.loadPdf).toHaveBeenCalled());

    await user.keyboard("{Escape}");
    const late = { numPages: 1 };
    finish(late);

    await waitFor(() => expect(pdf.destroyPdf).toHaveBeenCalledWith(late));
    expect(pdf.renderPagePreview).not.toHaveBeenCalled();
  });

  it("says so when a photo doesn't load, and tries again with fresh links", async () => {
    const user = userEvent.setup();
    documentQuery.data = { ...PHOTO, downloadUrl: "https://signed/photo" };
    render(<Harness initial="d-2" />);

    fireEvent.error(screen.getByRole("img", { name: "House photo" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(documentQuery.refetch).toHaveBeenCalled();
    expect(await screen.findByRole("img", { name: "House photo" })).toBeInTheDocument();
  });

  it("saves through the links in hand while they're fresh", async () => {
    const user = userEvent.setup();
    documentQuery.data = {
      ...PHOTO,
      downloadUrl: "https://signed/photo",
      forcedDownloadUrl: "https://signed/photo-attachment",
    };
    documentQuery.dataUpdatedAt = Date.now();
    render(<Harness initial="d-2" />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(assign).toHaveBeenCalledWith("https://signed/photo-attachment");
    expect(mockSignedLinks).not.toHaveBeenCalled();
  });

  it("tells a screen reader which file a step lands on, back to the first included", async () => {
    const user = userEvent.setup();
    render(<Harness initial="d-1" />);
    const live = () => screen.getByRole("dialog").querySelector("[aria-live]")!;
    expect(live().textContent).toBe("");

    await user.keyboard("{ArrowRight}");
    expect(live().textContent).toBe("House photo. File 2 of 3.");
    await user.keyboard("{ArrowLeft}");
    expect(live().textContent).toBe("Chapter bylaws. File 1 of 3.");
  });

  it("tries again with the refetched link, not the one that failed", async () => {
    const user = userEvent.setup();
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/dead" };
    pdf.loadPdf.mockRejectedValueOnce(new Error("expired"));
    documentQuery.refetch.mockImplementationOnce(() => {
      documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/fresh" };
      return Promise.resolve(undefined);
    });
    const { rerender } = render(<Harness initial="d-1" />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));
    rerender(<Harness initial="d-1" />);

    await screen.findByRole("img", { name: /page 1 of 2/ });
    expect(globalThis.fetch).toHaveBeenLastCalledWith("https://signed/fresh");
  });

  it("moves to a newer link on its own when the pinned one failed", async () => {
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/old" };
    pdf.loadPdf.mockRejectedValueOnce(new Error("expired"));
    const { rerender } = render(<Harness initial="d-1" />);
    await screen.findByText("Couldn't load this preview.");

    // The refetch on mount lands after the old link failed.
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/new" };
    rerender(<Harness initial="d-1" />);

    await screen.findByRole("img", { name: /page 1 of 2/ });
    expect(globalThis.fetch).toHaveBeenLastCalledWith("https://signed/new");
  });

  it("gives a photo a fresh try when a new link arrives", () => {
    documentQuery.data = { ...PHOTO, downloadUrl: "https://signed/one" };
    const { rerender } = render(<Harness initial="d-2" />);
    fireEvent.error(screen.getByRole("img", { name: "House photo" }));
    expect(screen.getByText("Couldn't load this preview.")).toBeInTheDocument();

    documentQuery.data = { ...PHOTO, downloadUrl: "https://signed/two" };
    rerender(<Harness initial="d-2" />);

    expect(screen.getByRole("img", { name: "House photo" })).toHaveAttribute(
      "src",
      "https://signed/two",
    );
  });

  it("asks for fresh links to save once the ones in hand are near their hour", async () => {
    const user = userEvent.setup();
    documentQuery.data = {
      ...PHOTO,
      downloadUrl: "https://signed/photo",
      forcedDownloadUrl: "https://signed/old-attachment",
    };
    documentQuery.dataUpdatedAt = Date.now() - 55 * 60 * 1000;
    mockSignedLinks.mockResolvedValue({
      ...PHOTO,
      downloadUrl: "https://signed/photo",
      forcedDownloadUrl: "https://signed/new-attachment",
    });
    render(<Harness initial="d-2" />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://signed/new-attachment"));
    expect(mockSignedLinks).toHaveBeenCalledWith("d-2");
  });

  it("doesn't close on a drag that starts and ends beside the pages", async () => {
    documentQuery.data = { ...BYLAWS, downloadUrl: "https://signed/inline" };
    render(<Harness initial="d-1" />);
    await screen.findByRole("img", { name: /page 2 of 2/ });
    const column = screen
      .getByRole("dialog")
      .querySelector<HTMLElement>(`[${VIEWER_BACKDROP_ATTRIBUTE}]`)!;
    Object.defineProperty(column, "clientWidth", { value: 600 });
    Object.defineProperty(column, "clientHeight", { value: 800 });
    column.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;

    // An overlay scrollbar's thumb takes no width: only the movement tells.
    fireEvent.pointerDown(column, { button: 0, clientX: 595, clientY: 100 });
    fireEvent.pointerUp(column, { button: 0, clientX: 595, clientY: 400 });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
