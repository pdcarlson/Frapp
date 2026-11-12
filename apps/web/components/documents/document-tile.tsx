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
import { cn } from "@/lib/utils";

/**
 * The Grid layout's columns (#4175). Wider tiles than the Directory's
 * (`denseGridClassName`): a file tile carries up to four controls along its
 * foot, which need about 160px, so it starts at one column and adds one per
 * step of the list's own width, as Google Drive's file grid does.
 */
export const documentGridClassName =
  "grid grid-cols-1 gap-2 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4";

/**
 * One file in the Grid layout (#4175), drawn the way Google Drive draws a
 * file in its grid: a preview panel naming the file's type over its name and
 * who uploaded it when. It shows every fact the row shows (uploader and date,
 * folder, type, effective date, description), and keeps the row's Star, Pin,
 * Download and Delete at its foot (`DocumentControls`), so the grid changes
 * the shape of the list and nothing a member can do with it.
 *
 * The preview is the file's type, not its pages: drawing a page means
 * fetching every file on the screen, which the list never does. The type is
 * the one `classifyFile` gives the filter and the viewer, so the tile, the
 * File type chip and the viewer all name a file alike. A pinned file's glyph
 * takes the accent duotone, as its card on the strip above does.
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
  // The row's facts (`documentFacts`), over three lines: when and by whom,
  // then where and what, then the description, last as the row puts it.
  const facts = documentFacts(doc, uploader);
  const filed = facts.filed.join(" · ");
  return (
    <li className={cn("flex min-w-0 flex-col", gridTileFrameClassName)}>
      {/*
        The preview and the lines under it are one button that opens the
        viewer, as the row's name is; the controls sit below it, never inside.
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
        <span
          className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-sm bg-surface-1"
          aria-hidden
        >
          <DocumentsGlyph
            className={cn(
              "h-8 w-8",
              pinned ? "text-accent-text" : "text-muted",
            )}
            active={pinned}
          />
          <span className="text-caption text-muted">{typeLabel}</span>
        </span>
        <span className="block min-w-0 px-1">
          <span className="block truncate text-sm font-semibold">
            {doc.title}
          </span>
          <span className="block truncate text-caption text-muted">
            {facts.uploaded}
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
        className="justify-end px-1 pb-1"
      />
    </li>
  );
}
