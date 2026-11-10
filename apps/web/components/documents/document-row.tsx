"use client";

import { Download, Loader2, Trash2 } from "lucide-react";
import { formatDay } from "@repo/formatting";
import { uploadedLine } from "@repo/hooks/document-library";
import { IconButton } from "@/components/ui/icon-button";
import { FOCUS_RING } from "@/components/ui/focus";
import { Can } from "@/components/shared/can";
import { DocumentsGlyph } from "@/components/documents/resources-glyphs";
import { OPEN_DOCUMENT_ATTRIBUTE } from "@/components/documents/document-viewer";
import { useDocumentDownload } from "@/components/documents/use-document-download";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import type { ChapterDocument } from "@/components/documents/document-types";
import { cn, labelled } from "@/lib/utils";

function DownloadButton({ id, title }: { id: string; title: string }) {
  const { download, fetchingId } = useDocumentDownload();
  const isFetching = fetchingId === id;

  /*
    Icon-only, like Delete beside it (components.md § Icon-only actions). The
    word used to stay, on the grounds that an icon-only download needs a
    tooltip to be usable. `IconButton` carries one: the native `title`, plus
    the `aria-label` a screen reader reads.
  */
  return (
    <IconButton
      label={`Download ${title}`}
      onClick={() => void download(id)}
      disabled={isFetching}
      aria-busy={isFetching}
    >
      {isFetching ? <Loader2 className="animate-spin" /> : <Download />}
    </IconButton>
  );
}

export function DocumentRow({
  doc,
  uploader,
  gate,
  deleting,
  onOpen,
  onDelete,
}: {
  doc: ChapterDocument;
  /** Who uploaded it, when the roster can name them (#3852). */
  uploader: string | null;
  gate: SubscriptionGate;
  deleting: boolean;
  /** Opens the document in the viewer (#3849). */
  onOpen: (doc: ChapterDocument) => void;
  onDelete: (doc: ChapterDocument) => void;
}) {
  return (
    /*
    Two lines, not three, and 8px of padding rather than 12. The
    description used to take a line of its own between the title
    and the meta; it now joins the meta line, which is where a
    one-clamped sentence was already headed and costs the row
    20px less.

    The board's `4d` data row is 40px and this one is floored at
    44 by `min-h-11`, deliberately: §2's touch-target floor
    outranks the board's density, and the 4px is the cheapest
    place in the lane to pay it. Do not "correct" the row to 40
    to match the board.
  */
    <li className="flex min-h-11 flex-col gap-1 py-1 @md:flex-row @md:items-center @md:gap-3">
      {/*
      s12 draws a leading file glyph on every document row —
      the accent duotone on its pinned cards, the neutral one
      on the recent list. Web has no pin field, so every row
      takes the neutral variant.
    */}
      {/*
        The glyph and both lines are one button that opens the document
        (#3849), so the whole name is the target, not a word in it. Download
        and Delete stay beside it as their own controls. It lifts to the
        hover step, which is how a transparent row says it opens something
        (components.md §2).
      */}
      <button
        type="button"
        onClick={() => onOpen(doc)}
        {...{ [OPEN_DOCUMENT_ATTRIBUTE]: doc.id }}
        className={cn(
          "-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-card-hover",
          FOCUS_RING,
        )}
      >
        <DocumentsGlyph className="hidden h-4 w-4 shrink-0 text-muted @md:block" />
        <span className="block min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{doc.title}</span>
          {/*
          Description LAST, and the order is load-bearing. The
          merged line is `truncate`, where the two lines it
          replaced were not: the meta line wrapped and the
          description had its own `line-clamp-1`. So whatever
          leads this string is what survives a narrow row — and
          with the description first, one ordinary sentence ate
          the upload date, the folder, the type and the effective
          date, none of which had ever been able to disappear
          before. The structured fields are short, bounded and
          the ones a member scans by; the description is the
          free-text field and the right thing to lose to an
          ellipsis.
        */}
          <span className="block truncate text-caption text-muted">
            {[
              uploadedLine(formatDay(doc.created_at), uploader),
              doc.folder,
              doc.document_type,
              labelled("Effective", formatDay(doc.effective_date)),
              doc.description,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1 @md:ml-auto">
        <DownloadButton id={doc.id} title={doc.title} />
        <Can permission="chapter_docs:manage">
          {/*
          `DELETE /v1/documents/:id` sits behind the same guard
          as upload, so gating only the upload trigger would
          have the page claim writes are blocked while still
          offering one per row.
        */}
          <IconButton
            label={`Delete ${doc.title}`}
            onClick={() => onDelete(doc)}
            {...gate.controlProps(deleting)}
          >
            <Trash2 />
          </IconButton>
        </Can>
      </div>
    </li>
  );
}
