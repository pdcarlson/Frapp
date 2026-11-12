"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { selectDownloadUrl, useDocument } from "@repo/hooks";
import { DocumentsGlyph } from "@/components/documents/resources-glyphs";
import type { ChapterDocument } from "@/components/documents/document-types";
import {
  previewKind,
  type PreviewKind,
} from "@/components/documents/document-viewer";
import {
  destroyPdf,
  loadPdf,
  renderPagePreview,
} from "@/lib/backwork-bulk/pdf";
import { cn } from "@/lib/utils";

/**
 * The largest file a grid tile previews (#4647). A tile draws from the same
 * signed link the viewer opens, and storage serves the original (no resized
 * copy yet: #2912), so a tile downloads the whole file. Past this, the tile
 * is the compact one, glyph beside the title, and the viewer still opens it.
 */
export const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/**
 * What a grid tile draws above the title: the file itself for a photo or a
 * PDF small enough to fetch, otherwise nothing (`"none"`). Word, Excel and the
 * rest never preview here, as in the viewer (#3889).
 */
export function thumbnailKind(
  doc: Pick<ChapterDocument, "content_type" | "storage_path" | "byte_size">,
): PreviewKind {
  if ((doc.byte_size ?? 0) > MAX_THUMBNAIL_BYTES) {
    return "none";
  }
  return previewKind(doc);
}

/** CSS width the first page is drawn for; a tile is at most about 300px. */
const PDF_THUMBNAIL_WIDTH = 320;

/** First pages drawn at once, so a grid of PDFs doesn't fetch them all together. */
const PDF_CONCURRENCY = 2;

/** First pages already drawn, by stored file, so a layout switch doesn't redraw. */
const pdfThumbnails = new Map<string, Promise<string>>();
/** Oldest first; past this many, the oldest drawn page is let go. */
const MAX_CACHED_PDF_THUMBNAILS = 60;

let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= PDF_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function drawFirstPage(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`The file didn't load (${response.status}).`);
  const pdf = await loadPdf(new Uint8Array(await response.arrayBuffer()));
  try {
    return (await renderPagePreview(pdf, 1, PDF_THUMBNAIL_WIDTH)).url;
  } finally {
    void destroyPdf(pdf);
  }
}

/**
 * A PDF's first page as an image URL, drawn by the viewer's renderer
 * (`renderPagePreview`, pdf.js in the member's own browser). Keyed by the
 * stored path, which a document never changes, so the link can rotate.
 */
function pdfThumbnail(storagePath: string, url: string): Promise<string> {
  const cached = pdfThumbnails.get(storagePath);
  if (cached) return cached;
  const made = withSlot(() => drawFirstPage(url));
  pdfThumbnails.set(storagePath, made);
  // A failure isn't kept: the next visit tries again.
  made.catch(() => pdfThumbnails.delete(storagePath));
  if (pdfThumbnails.size > MAX_CACHED_PDF_THUMBNAILS) {
    const [oldest, page] = pdfThumbnails.entries().next().value!;
    pdfThumbnails.delete(oldest);
    void page.then(
      (src) => URL.revokeObjectURL(src),
      () => undefined,
    );
  }
  return made;
}

/** Test seam: forget every drawn page. */
export function resetPdfThumbnailsForTest() {
  pdfThumbnails.clear();
}

/**
 * True once the element has come within a screen of the viewport, and stays
 * true. Without IntersectionObserver (jsdom) it stays false, so nothing is
 * fetched.
 */
function useNearViewport(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (near || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

/**
 * A grid tile's preview (#4647): the photo itself, or a PDF's first page, in
 * a 4:3 frame cropped from the top, as Google Drive and Dropbox draw theirs.
 * Fetched only once the tile nears the screen, through `GET
 * /v1/documents/{id}`, the read the viewer makes, so opening the file after
 * reuses its link. Until it draws, the frame pulses; if it can't draw, it
 * shows the type glyph and label, the tile's old face.
 */
export function DocumentThumbnail({
  doc,
  kind,
  typeLabel,
  pinned,
}: {
  doc: ChapterDocument;
  kind: Exclude<PreviewKind, "none">;
  typeLabel: string;
  pinned: boolean;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(frameRef);
  const query = useDocument(doc.id, { enabled: near });
  const url = selectDownloadUrl(query.data);
  const [failed, setFailed] = useState(false);
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "pdf" || !url) return;
    let cancelled = false;
    pdfThumbnail(doc.storage_path, url).then(
      (src) => {
        if (!cancelled) setPdfSrc(src);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, url, doc.storage_path]);

  const src = kind === "image" ? url : pdfSrc;
  const broken = failed || (query.isError && !url);

  return (
    <span
      ref={frameRef}
      aria-hidden
      data-thumbnail={kind}
      className={cn(
        "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-sm bg-surface-1",
        !src && !broken && "animate-pulse motion-reduce:animate-none",
      )}
    >
      {broken ? (
        <span className="flex flex-col items-center gap-1.5">
          <DocumentsGlyph
            className={cn(
              "h-8 w-8",
              pinned ? "text-accent-text" : "text-muted",
            )}
            active={pinned}
          />
          <span className="text-caption text-muted">{typeLabel}</span>
        </span>
      ) : src ? (
        /* A plain <img>, as the viewer draws one: the signed URL's query
           string is the signature, which the Next image loader would strip. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            "h-full w-full object-cover",
            // A page reads from its top, and is white like paper.
            kind === "pdf" && "bg-white object-top",
          )}
        />
      ) : null}
    </span>
  );
}
