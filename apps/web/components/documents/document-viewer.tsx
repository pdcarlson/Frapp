"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import {
  selectDownloadUrl,
  selectForcedDownloadUrl,
  useDocument,
} from "@repo/hooks";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { isViewableImage } from "@repo/chat-core/attachments";
import { formatDay } from "@repo/formatting";
import {
  MediaViewer,
  VIEWER_BACKDROP_ATTRIBUTE,
  VIEWER_CONTROL,
  VIEWER_CONTROL_SIZE,
} from "@/components/shared/media-viewer";
import { useDocumentDownload } from "@/components/documents/use-document-download";
import type { ChapterDocument } from "@/components/documents/document-types";
import { destroyPdf, loadPdf, renderPagePreview } from "@/lib/backwork-bulk/pdf";
import { cn, labelled } from "@/lib/utils";

/** The attribute each row's open control carries, for focus to find it on close. */
export const OPEN_DOCUMENT_ATTRIBUTE = "data-document-open";

/** How a file is shown: drawn in place, or a card that offers the download. */
export type PreviewKind = "pdf" | "image" | "none";

/**
 * Photos (chat's raster list: JPEG, PNG, GIF, WebP, BMP) and PDFs preview.
 * Everything else, Office files included, gets the download card: rendering
 * those needs a converter or an outside viewer, a privacy call tracked in
 * #3889. The declared type is what the bucket gated, so it decides; the stored
 * extension stands in only for a row filed before the type was recorded.
 */
export function previewKind(doc: Pick<ChapterDocument, "content_type" | "storage_path">): PreviewKind {
  const type = doc.content_type?.split(";")[0]?.trim().toLowerCase() ?? null;
  if (type === "application/pdf") return "pdf";
  if (isViewableImage(type)) return "image";
  if (type === null && /\.pdf$/i.test(doc.storage_path)) return "pdf";
  return "none";
}

const KIND_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "Word document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/vnd.ms-excel": "Excel spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel spreadsheet",
  "application/vnd.ms-powerpoint": "PowerPoint deck",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint deck",
  "text/plain": "Text file",
  "text/csv": "CSV file",
};

function kindLabel(doc: ChapterDocument): string {
  const type = doc.content_type?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (KIND_LABEL[type]) return KIND_LABEL[type];
  if (previewKind(doc) === "pdf") return "PDF";
  if (previewKind(doc) === "image") return "Photo";
  return "File";
}

/** Pages drawn at most; a longer file says so and offers the download. */
export const MAX_PREVIEW_PAGES = 50;

/**
 * A chapter document, full screen (#3849), in the viewer chat's images open in
 * (`MediaViewer`). Clicking a row opens it; the arrows step through the list
 * as the page currently shows it, wrapping at the ends.
 *
 * PDFs are drawn page by page with pdf.js into images, in the member's own
 * browser, and photos in an `<img>`. Neither loads the file as a document, so
 * the viewer keeps the trust rule chat's does, and nothing is sent anywhere
 * but our own storage. Any other type shows a card with its details and the
 * download.
 *
 * The title is drawn top-left, where chat's viewer draws nothing: a chat
 * filename is whatever the sender's device called the file, but a document's
 * title is the one its uploader typed.
 */
export function DocumentViewer({
  documents,
  openId,
  onOpenChange,
}: {
  /** The rows in the order the list shows them. */
  documents: readonly ChapterDocument[];
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}) {
  const index = openId === null ? -1 : documents.findIndex((doc) => doc.id === openId);
  const doc = index === -1 ? undefined : documents[index];

  // A row that leaves the list (deleted, or filtered out by a refetch) closes
  // the viewer rather than leaving it open on nothing.
  const lost = openId !== null && doc === undefined;
  useEffect(() => {
    if (lost) onOpenChange(null);
  }, [lost, onOpenChange]);

  if (!doc) return null;
  return (
    <OpenDocumentViewer
      doc={doc}
      index={index}
      total={documents.length}
      onStep={(delta) =>
        onOpenChange(documents[(index + delta + documents.length) % documents.length]!.id)
      }
      onClose={() => onOpenChange(null)}
    />
  );
}

/**
 * One dialog for the whole visit: stepping swaps what it shows, never the
 * dialog, so the backdrop doesn't fade in again, focus stays inside, and the
 * close-focus hook runs once, when the member actually closes it. Only the
 * per-file part (`DocumentPreview`) is keyed by document.
 */
function OpenDocumentViewer({
  doc,
  index,
  total,
  onStep,
  onClose,
}: {
  doc: ChapterDocument;
  index: number;
  total: number;
  onStep: (delta: -1 | 1) => void;
  onClose: () => void;
}) {
  const kind = previewKind(doc);
  // The signed links, for a file that previews. A file that doesn't is never
  // fetched or shown, so it asks for nothing until Download is pressed.
  // `GET /v1/documents/{id}` refetches on focus once stale, minting a new
  // link; an image follows it, and a PDF keeps the pages it already drew.
  const query = useDocument(doc.id, { enabled: kind !== "none" });
  const { download, fetchingId } = useDocumentDownload();
  const fetching = fetchingId === doc.id;
  // The links in hand save without another request; near the end of their
  // hour, or for a file whose links were never fetched, `download` asks for
  // fresh ones.
  function save() {
    const cached =
      query.dataUpdatedAt > Date.now() - SAVE_LINK_REUSE_MS
        ? selectForcedDownloadUrl(query.data)
        : null;
    if (cached) window.location.assign(cached);
    else void download(doc.id);
  }

  const label = kindLabel(doc);
  const meta = [label, labelled("Uploaded", formatDay(doc.created_at)), doc.folder]
    .filter(Boolean)
    .join(" · ");

  return (
    <MediaViewer
      open
      onClose={onClose}
      label={doc.title}
      description={meta}
      step={{ index, total, onStep, noun: "file" }}
      contentClassName={kind === "pdf" ? "items-stretch" : undefined}
      heading={
        <>
          <p className="truncate text-sm font-semibold text-white/90">{doc.title}</p>
          <p className="truncate text-caption text-white/60">{meta}</p>
        </>
      }
      // Back to the row of the document it was showing, which may not be the
      // one that opened it (the arrows step), as chat's viewer returns to the
      // image it was showing.
      onCloseAutoFocus={(event) => {
        const opener = document.querySelector<HTMLElement>(
          `[${OPEN_DOCUMENT_ATTRIBUTE}="${CSS.escape(doc.id)}"]`,
        );
        if (!opener) return;
        event.preventDefault();
        opener.focus();
      }}
      actions={
        <button
          type="button"
          aria-label="Download"
          title="Download"
          onClick={save}
          disabled={fetching}
          aria-busy={fetching}
          className={cn(VIEWER_CONTROL, VIEWER_CONTROL_SIZE)}
        >
          {fetching ? (
            <Loader2 aria-hidden="true" className="size-[18px] animate-spin" />
          ) : (
            <Download aria-hidden="true" className="size-[18px]" />
          )}
        </button>
      }
    >
      <DocumentPreview
        key={doc.id}
        doc={doc}
        kind={kind}
        label={label}
        query={query}
        onSave={save}
        saving={fetching}
      />
    </MediaViewer>
  );
}

/** Reuse the save link in hand while it's this fresh; links last an hour. */
const SAVE_LINK_REUSE_MS = 50 * 60 * 1000;

function DocumentPreview({
  doc,
  kind,
  label,
  query,
  onSave,
  saving,
}: {
  doc: ChapterDocument;
  kind: PreviewKind;
  label: string;
  query: ReturnType<typeof useDocument>;
  onSave: () => void;
  saving: boolean;
}) {
  const url = selectDownloadUrl(query.data);
  // Bumped once a retry's refetch has landed, so the remounted preview reads
  // the fresh link rather than the one that failed.
  const [attempt, setAttempt] = useState(0);
  const { refetch } = query;
  async function retry() {
    await refetch();
    setAttempt((n) => n + 1);
  }

  if (kind === "none") {
    return (
      <Notice
        title={
          label === "File"
            ? "This file can't be previewed yet."
            : `${label}s can't be previewed yet.`
        }
        detail="Download it to open it on your device."
        action={{ label: "Download", onClick: onSave, busy: saving }}
      />
    );
  }
  if (query.isError && !url) {
    return (
      <Notice
        title="Couldn't load this preview."
        detail={describeLoadFailure(query.error)}
        action={{ label: "Try again", onClick: () => void retry() }}
      />
    );
  }
  if (!url) return <PageSkeleton />;
  if (kind === "image") {
    // Keyed by link and attempt, so a fresh link (a refetch on focus) or a Try
    // again gets a
    // fresh attempt rather than the last link's failure.
    return (
      <ImagePreview
        key={`${attempt}:${url}`}
        url={url}
        title={doc.title}
        onRetry={() => void retry()}
      />
    );
  }
  return (
    <PdfPages
      key={attempt}
      url={url}
      // A link pinned from an old cache entry can be past its hour; when the
      // load fails and a newer one has arrived since, try that one.
      onStale={() => setAttempt((n) => n + 1)}
      title={doc.title}
      onRetry={() => void retry()}
      onDownload={onSave}
    />
  );
}

function ImagePreview({
  url,
  title,
  onRetry,
}: {
  url: string;
  title: string;
  onRetry: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Notice
        title="Couldn't load this preview."
        detail="Check your connection and try again, or download the file."
        action={{ label: "Try again", onClick: onRetry }}
      />
    );
  }
  /* A plain <img>, as chat's viewer draws one: the signed URL's query string
     is the signature, and the Next image loader would strip it. An image whose
     bytes don't decode (the bucket gates the declared type, not the bytes) or
     whose link failed lands on the notice above. */
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={title}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full rounded-sm object-contain"
    />
  );
}

type PdfState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; pages: string[]; total: number; done: boolean };

/**
 * A PDF's pages, top to bottom, in a column that scrolls under the corner
 * controls. Pages arrive one at a time, so the first is readable while the
 * rest draw. The link is read once: a refetch that mints a new one doesn't
 * reload pages already drawn.
 */
function PdfPages({
  url,
  title,
  onRetry,
  onStale,
  onDownload,
}: {
  url: string;
  title: string;
  onRetry: () => void;
  /** The load failed and `url` has moved on from the link it pinned. */
  onStale: () => void;
  onDownload: () => void;
}) {
  const [src] = useState(url);
  const [state, setState] = useState<PdfState>({ status: "loading" });
  const stale = state.status === "error" && url !== src;
  useEffect(() => {
    if (stale) onStale();
  }, [stale, onStale]);

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    let pdf: Awaited<ReturnType<typeof loadPdf>> | null = null;

    (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`The file didn't load (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        const loaded = await loadPdf(bytes);
        // Torn down here when the viewer moved on while pdf.js parsed: the
        // cleanup below ran before there was anything to destroy.
        if (cancelled) {
          void destroyPdf(loaded);
          return;
        }
        pdf = loaded;
        const total = pdf.numPages;
        const count = Math.min(total, MAX_PREVIEW_PAGES);
        for (let number = 1; number <= count; number += 1) {
          const page = await renderPagePreview(pdf, number, 900);
          if (cancelled) {
            URL.revokeObjectURL(page.url);
            return;
          }
          made.push(page.url);
          setState({ status: "ready", pages: [...made], total, done: number === count });
        }
      } catch (error) {
        if (!cancelled) setState({ status: "error", error });
      }
    })();

    return () => {
      cancelled = true;
      for (const page of made) URL.revokeObjectURL(page);
      if (pdf) void destroyPdf(pdf);
    };
  }, [src]);

  if (state.status === "error") {
    return (
      <Notice
        title="Couldn't load this preview."
        detail="Check your connection and try again, or download the file."
        action={{ label: "Try again", onClick: onRetry }}
      />
    );
  }
  if (state.status === "loading") return <PageSkeleton />;

  return (
    <div
      {...{ [VIEWER_BACKDROP_ATTRIBUTE]: "" }}
      className="flex w-full flex-col items-center gap-4 overflow-y-auto pt-10 sm:pt-6"
    >
      {state.pages.map((page, i) => (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={page}
          src={page}
          alt={state.total > 1 ? `${title}, page ${i + 1} of ${state.total}` : title}
          className="w-full max-w-[900px] rounded-sm bg-white shadow-lg"
        />
      ))}
      {!state.done ? <PageSkeleton /> : null}
      {state.done && state.total > state.pages.length ? (
        <Notice
          title={`Showing the first ${state.pages.length} of ${state.total} pages.`}
          detail="Download the file to read the rest."
          action={{ label: "Download", onClick: onDownload }}
        />
      ) : null}
    </div>
  );
}

/** A page-shaped placeholder, the shape the first page takes. */
function PageSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading preview"
      className="aspect-[8.5/11] w-full max-w-[min(900px,calc((100vh-7rem)*0.77))] shrink-0 animate-pulse self-center rounded-sm bg-white/10 motion-reduce:animate-none"
    />
  );
}

function Notice({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: { label: string; onClick: () => void; busy?: boolean };
}) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-1.5 self-center py-6 text-center text-white/85">
      <FileText aria-hidden="true" className="mb-2 size-14 text-white/50" strokeWidth={1.5} />
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-caption text-white/60">{detail}</p>
      <button
        type="button"
        onClick={action.onClick}
        disabled={action.busy}
        aria-busy={action.busy}
        className={cn(
          VIEWER_CONTROL,
          "mt-3 h-9 gap-2 border-white/25 px-3.5 text-sm font-semibold text-white pointer-coarse:h-11",
        )}
      >
        {action.label === "Download" ? <Download aria-hidden="true" className="size-4" /> : null}
        {action.label}
      </button>
    </div>
  );
}
