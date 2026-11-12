"use client";

import { classifyFile } from "@repo/hooks/document-library";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { DocumentsGlyph } from "@/components/documents/resources-glyphs";
import { OPEN_DOCUMENT_ATTRIBUTE } from "@/components/documents/document-viewer";
import {
  DocumentControls,
  documentFacts,
} from "@/components/documents/document-row";
import { gridTileFrameClassName } from "@/components/shared/table-controls";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import type { ChapterDocument } from "@/components/documents/document-types";
import {
  DocumentThumbnail,
  thumbnailKind,
} from "@/components/documents/document-thumbnail";
import { cn } from "@/lib/utils";

/**
 * The Grid layout's columns (#4175, narrowed in #4647). As many tiles as fit,
 * so a tile stays about 200 to 260px wide on a desktop, as Google Drive's and
 * Dropbox's file grids are, rather than a fixed count stretched across the
 * list. Under a 768px list (beside chat, or at the 375px floor) a tile may
 * narrow to 160px, so two still fit side by side; its controls wrap there.
 */
export const documentGridClassName =
  "grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2 @3xl:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]";

/**
 * One file in the Grid layout (#4175), drawn the way Google Drive draws a
 * file in its grid. A photo or a PDF leads with a preview of itself
 * (`DocumentThumbnail`, #4647): the photo, or the PDF's first page. Any other
 * file, and one too large to fetch for a tile, has no preview panel at all:
 * its type glyph sits beside the title, so the tile isn't padded with an
 * empty box (Word and Excel previews are #3889's call). Under the title, every
 * fact the row shows (type, uploader and date, folder, document type,
 * effective date, description), and right under those the row's Star, Pin,
 * Download and Delete (`DocumentControls`), so the grid changes the shape of
 * the list and nothing a member can do with it.
 *
 * The type is the one `classifyFile` gives the filter and the viewer, so the
 * tile, the File type chip and the viewer all name a file alike. A pinned
 * file's glyph takes the accent duotone, as its card on the strip above does.
 *
 * A hairline-bordered tile on the page, not a `--card` panel, like the
 * Directory's member tiles: the route still has no cards in its list.
 */
export function DocumentTile({
  doc,
  uploader,
  gate,
  deleting,
  starred,
  pinBusy,
  onOpen,
  onDelete,
  onToggleStar,
  onTogglePin,
}: {
  doc: ChapterDocument;
  /** Who uploaded it, when the roster can name them (#3852). */
  uploader: string | null;
  gate: SubscriptionGate;
  deleting: boolean;
  starred: boolean;
  pinBusy: boolean;
  onOpen: (doc: ChapterDocument) => void;
  onDelete: (doc: ChapterDocument) => void;
  onToggleStar: (doc: ChapterDocument) => void;
  onTogglePin: (doc: ChapterDocument) => void;
}) {
  const pinned = !!doc.pinned_at;
  const { label: typeLabel } = classifyFile(doc);
  const preview = thumbnailKind(doc);
  // The row's facts (`documentFacts`), over three lines: when and by whom,
  // then where and what, then the description, last as the row puts it.
  const facts = documentFacts(doc, uploader);
  const filed = facts.filed.join(" · ");
  return (
    <li className={cn("flex min-w-0 flex-col", gridTileFrameClassName)}>
      {/*
        The preview and the lines under it are one button that opens the
        viewer, as the row's name is; the controls sit right below the facts,
        never inside, and never pushed to the tile's far edge.
      */}
      <button
        type="button"
        onClick={() => onOpen(doc)}
        {...{ [OPEN_DOCUMENT_ATTRIBUTE]: doc.id }}
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-2 rounded-t-md p-2 text-left transition-colors hover:bg-card-hover",
          FOCUS_RING_OFFSET,
        )}
      >
        {preview !== "none" ? (
          <DocumentThumbnail
            doc={doc}
            kind={preview}
            typeLabel={typeLabel}
            pinned={pinned}
          />
        ) : null}
        <span className="flex min-w-0 items-start gap-2 px-1">
          {preview === "none" ? (
            <DocumentsGlyph
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0",
                pinned ? "text-accent-text" : "text-muted",
              )}
              active={pinned}
            />
          ) : null}
          <span className="block min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {doc.title}
            </span>
            <span className="block truncate text-caption text-muted">
              {[typeLabel, facts.uploaded].filter(Boolean).join(" · ")}
            </span>
            {filed ? (
              <span className="block truncate text-caption text-muted">
                {filed}
              </span>
            ) : null}
            {facts.description ? (
              <span className="block truncate text-caption text-muted">
                {facts.description}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <DocumentControls
        doc={doc}
        gate={gate}
        deleting={deleting}
        starred={starred}
        pinBusy={pinBusy}
        onDelete={onDelete}
        onToggleStar={onToggleStar}
        onTogglePin={onTogglePin}
        className="flex-wrap px-1.5 pb-1"
      />
    </li>
  );
}
