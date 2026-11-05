import type { PDFDocumentProxy } from "pdfjs-dist";
import { assembleFlatPdf, type FlatPage } from "./assemble";
import type { BoxesByPage } from "./geometry";
import {
  placeTextItems,
  textOutsideBoxes,
  type RawTextItem,
} from "./text-layer";

/**
 * Browser-only pdf.js glue for backwork bulk upload (#3499): loading, page
 * previews for the editor, and flattening. pdf.js is imported on first use, so
 * `/backwork` and every other page never download it; its worker ships from
 * our own bundle, never a CDN.
 */
// The legacy build carries core-js polyfills. The modern build calls APIs
// as new as `Map.prototype.getOrInsertComputed` without them, which older
// Safari and Chrome versions on members' laptops don't have.
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
        { type: "module" },
      );
    }
    return pdfjs;
  });
  return pdfjsPromise;
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  // pdf.js transfers the buffer to its worker, so hand it a copy and keep the
  // caller's bytes (the original, which a Blank Copy uploads as-is) intact.
  // pdf.js 6 no longer evaluates font code at all, so there is no eval switch.
  // The decoders and fonts load from our own origin
  // (`scripts/copy-pdfjs-assets.mjs`); without the wasm a JPEG 2000 or JBIG2
  // scan, which is most copier output, renders blank.
  const base = `/pdfjs/${pdfjs.version}/`;
  return pdfjs.getDocument({
    data: bytes.slice(),
    enableXfa: false,
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    iccUrl: `${base}iccs/`,
  }).promise;
}

export type PagePreview = {
  url: string;
  /** Page size in points (viewport at scale 1): the boxes' coordinate space. */
  width: number;
  height: number;
};

/** Renders one page for the editor, sized for a column about `targetWidth` CSS px wide. */
export async function renderPagePreview(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth = 900,
): Promise<PagePreview> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const scale = Math.min((targetWidth * Math.max(ratio, 1)) / base.width, 4);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const { AnnotationMode } = await loadPdfJs();
  await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;
  const blob = await canvasBlob(canvas, "image/jpeg", 0.9);
  releaseCanvas(canvas);
  page.cleanup();
  return {
    url: URL.createObjectURL(blob),
    width: base.width,
    height: base.height,
  };
}

export type FlattenOptions = {
  /** Render resolution of the stored page images. */
  dpi?: number;
  /** JPEG quality, 0 to 1. */
  quality?: number;
  /** Redraw the text outside the boxes as an invisible, searchable layer. */
  keepText?: boolean;
};

/** Longest side, in pixels, of any stored page image. */
const MAX_PAGE_PIXELS = 4096;

/**
 * Flattens every page to an image with the boxes burned in, keeps the text
 * outside the boxes, and assembles a new PDF (`assemble.ts`). Pages are done
 * one at a time with a yield between them, so the editor stays responsive
 * while the previous document finishes in the background.
 */
export async function flattenPdf(
  doc: PDFDocumentProxy,
  boxes: BoxesByPage,
  { dpi = 150, quality = 0.82, keepText = true }: FlattenOptions = {},
): Promise<Uint8Array> {
  const { AnnotationMode } = await loadPdfJs();
  const pages: FlatPage[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      dpi / 72,
      MAX_PAGE_PIXELS / Math.max(base.width, base.height),
    );
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    // Form fields are drawn into the image too (pdf.js otherwise leaves them
    // to an HTML layer we don't have), so the flattened page shows what the
    // editor showed: a name typed into a field is visible to box, and gone
    // once boxed.
    await page.render({ canvas, viewport, annotationMode: AnnotationMode.ENABLE }).promise;

    const pageBoxes = boxes[number] ?? [];
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw the redacted page.");
    ctx.fillStyle = "#000";
    for (const box of pageBoxes) {
      ctx.fillRect(
        Math.floor(box.x * scale),
        Math.floor(box.y * scale),
        Math.ceil(box.width * scale) + 1,
        Math.ceil(box.height * scale) + 1,
      );
    }
    const jpeg = new Uint8Array(
      await (await canvasBlob(canvas, "image/jpeg", quality)).arrayBuffer(),
    );
    releaseCanvas(canvas);

    let text: FlatPage["text"] = [];
    if (keepText) {
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item): item is RawTextItem & typeof item => "str" in item,
      );
      text = textOutsideBoxes(
        placeTextItems(
          items,
          (x, y) => base.convertToViewportPoint(x, y),
          base.rotation,
        ),
        pageBoxes,
      );
    }
    pages.push({ width: base.width, height: base.height, jpeg, text });
    page.cleanup();
    await yieldToBrowser();
  }
  return assembleFlatPdf(pages);
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Couldn't render the page.")),
      type,
      quality,
    ),
  );
}

/** Safari keeps canvas memory until the element is shrunk. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
