"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
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
 * The largest file a grid tile previews (#4647). Storage serves the original,
 * with no resized copy yet (#2912), so a tile downloads the whole file. Past
 * this, or when the size was never recorded (documents filed before sizes
 * were), the tile is the compact one, glyph beside the title, and the viewer
 * still opens the file.
 */
export const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/**
 * What a grid tile draws above the title: the file itself for a photo or a
 * PDF known to be small enough to fetch, otherwise nothing (`"none"`). Word,
 * Excel and the rest never preview here, as in the viewer (#3889).
 */
export function thumbnailKind(
  doc: Pick<ChapterDocument, "content_type" | "storage_path" | "byte_size">,
): PreviewKind {
  if (doc.byte_size == null || doc.byte_size > MAX_THUMBNAIL_BYTES) {
    return "none";
  }
  return previewKind(doc);
}

/** CSS width the first page is drawn for; a tile is at most about 300px. */
const PDF_THUMBNAIL_WIDTH = 320;

/**
 * First pages drawn at once, so a grid of PDFs doesn't fetch them all
 * together. The loads share the viewer's pdf.js worker, and `loadPdf` and
 * `destroyPdf` queue around each other's teardowns.
 */
const PDF_CONCURRENCY = 2;

type CachedPage = { page: Promise<string>; src: string | null };

/**
 * First pages already drawn, by stored file (a document never changes its
 * file), so a layout switch, a refilter or a fresh link doesn't redraw. In
 * order of last use, oldest first.
 */
const pdfThumbnails = new Map<string, CachedPage>();
/** Past this many, the least recently used drawn pages are let go. */
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
  if (!response.ok) throw new Error(`The file didn't load (${response.status}).`);
  const pdf = await loadPdf(new Uint8Array(await response.arrayBuffer()));
  try {
    return (await renderPagePreview(pdf, 1, PDF_THUMBNAIL_WIDTH)).url;
  } finally {
    void destroyPdf(pdf);
  }
}

/**
 * Lets go of drawn pages past the cap, least recently used first. A page
 * still drawing is never let go: a tile is waiting on it.
 */
function trimPdfThumbnails() {
  for (const [path, entry] of pdfThumbnails) {
    if (pdfThumbnails.size <= MAX_CACHED_PDF_THUMBNAILS) return;
    if (entry.src === null) continue;
    pdfThumbnails.delete(path);
    URL.revokeObjectURL(entry.src);
  }
}

/**
 * A PDF's first page as an image URL, drawn by the viewer's renderer
 * (`renderPagePreview`, pdf.js in the member's own browser).
 */
export function pdfThumbnail(storagePath: string, url: string): Promise<string> {
  const cached = pdfThumbnails.get(storagePath);
  if (cached) {
    // Most recently used goes last.
    pdfThumbnails.delete(storagePath);
    pdfThumbnails.set(storagePath, cached);
    return cached.page;
  }
  const entry: CachedPage = { page: withSlot(() => drawFirstPage(url)), src: null };
  pdfThumbnails.set(storagePath, entry);
  entry.page.then(
    (src) => {
      entry.src = src;
      // Just drawn counts as just used, so a page a tile is about to show is
      // never the one let go.
      if (pdfThumbnails.get(storagePath) === entry) {
        pdfThumbnails.delete(storagePath);
        pdfThumbnails.set(storagePath, entry);
      }
      trimPdfThumbnails();
    },
    // A failure isn't kept: the next try draws again.
    () => {
      if (pdfThumbnails.get(storagePath) === entry) pdfThumbnails.delete(storagePath);
    },
  );
  return entry.page;
}

/** Drops a drawn page that failed to show, so the next try draws it again. */
function forgetPdfThumbnail(storagePath: string, src: string) {
  const entry = pdfThumbnails.get(storagePath);
  if (entry?.src !== src) return;
  pdfThumbnails.delete(storagePath);
  URL.revokeObjectURL(src);
}

/**
 * The link each photo first loaded from, by stored file. A fresh link is a
 * new signature, which the browser's cache has never seen, so a tile keeps
 * the one it loaded and moves to a fresh one only if that one stops loading.
 */
const shownImages = new Map<string, string>();

/** Test seam: forget every drawn page and shown link. */
export function resetThumbnailCachesForTest() {
  pdfThumbnails.clear();
  shownImages.clear();
  running = 0;
  waiting.length = 0;
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

/** Where the tile's signed link stands, from `useDocumentPreviews`. */
export type ThumbnailLink =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; url: string | null };

/**
 * A grid tile's preview (#4647): the photo itself, or a PDF's first page, in
 * a 4:3 frame cropped from the top, as Google Drive and Dropbox draw theirs.
 * The link comes from the list's one batch of preview links
 * (`useDocumentPreviews`); the file itself is fetched only once the tile
 * nears the screen. Until it draws, the frame pulses; if it can't draw, it
 * shows the type glyph and label.
 */
export function DocumentThumbnail({
  doc,
  kind,
  typeLabel,
  pinned,
  link,
}: {
  doc: ChapterDocument;
  kind: Exclude<PreviewKind, "none">;
  typeLabel: string;
  pinned: boolean;
  link: ThumbnailLink;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(frameRef);
  const url = link.status === "ready" ? link.url : null;
  // Failures are per link: a fresh link clears them.
  const [failure, setFailure] = useState<{ url: string | null } | null>(null);
  const failed = failure !== null && failure.url === url;
  const [pdfSrc, setPdfSrc] = useState<string | null>(null);
  // Bumped when a drawn page didn't show, to draw it once more.
  const [redraw, setRedraw] = useState(0);

  useEffect(() => {
    if (kind !== "pdf" || !url || !near || redraw > 1) return;
    let cancelled = false;
    pdfThumbnail(doc.storage_path, url).then(
      (src) => {
        if (!cancelled) setPdfSrc(src);
      },
      () => {
        if (!cancelled) setFailure({ url });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, url, near, redraw, doc.storage_path]);

  const imageSrc =
    kind === "image" && url && near
      ? (shownImages.get(doc.storage_path) ?? url)
      : null;
  const src = kind === "image" ? imageSrc : pdfSrc;
  const broken =
    failed ||
    link.status === "error" ||
    (link.status === "ready" && link.url === null);

  function onImageError() {
    if (kind === "pdf") {
      if (pdfSrc) forgetPdfThumbnail(doc.storage_path, pdfSrc);
      setPdfSrc(null);
      if (redraw >= 1) setFailure({ url });
      else setRedraw((n) => n + 1);
      return;
    }
    // A kept link that has expired: try the fresh one before giving up.
    if (imageSrc && imageSrc !== url) {
      shownImages.delete(doc.storage_path);
      setRedraw((n) => n + 1);
      return;
    }
    setFailure({ url });
  }

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
            className={cn("h-8 w-8", pinned ? "text-accent-text" : "text-muted")}
            active={pinned}
          />
          <span className="text-caption text-muted">{typeLabel}</span>
        </span>
      ) : src ? (
        /* A plain <img>, as the viewer draws one: the signed URL's query
           string is the signature, which the Next image loader would strip. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          onLoad={() => {
            if (kind === "image" && !shownImages.has(doc.storage_path)) {
              shownImages.set(doc.storage_path, src);
            }
          }}
          onError={onImageError}
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
