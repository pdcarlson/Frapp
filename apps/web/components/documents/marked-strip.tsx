"use client";

import { formatDay } from "@repo/formatting";
import type { MarkedItem as LibraryMarkedItem } from "@repo/hooks/document-library";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconButton } from "@/components/ui/icon-button";
import { SectionLabel } from "@/components/shared/section-label";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import {
  DocumentsGlyph,
  FolderGlyph,
  StarGlyph,
} from "@/components/documents/resources-glyphs";
import { OPEN_DOCUMENT_ATTRIBUTE } from "@/components/documents/document-viewer";
import type {
  ChapterDocument,
  FolderRow,
} from "@/components/documents/document-types";
import type { DocumentMarks } from "@/components/documents/use-document-marks";
import { cn } from "@/lib/utils";

/** A pinned or starred thing: a folder or a single file. */
export type MarkedItem = LibraryMarkedItem<
  FolderRow & { id: string },
  ChapterDocument
>;

/**
 * The cards above All files (#3934, `chapter-docs.md` § Pinned and starred):
 * what officers pinned for the chapter, then what this member starred, as
 * Google Drive draws its Suggested row and mobile's s12 draws PINNED. Folders
 * and files share a row of cards; a folder card opens the folder, a file card
 * opens the file.
 *
 * Shown only on the unfiltered All files view. Inside a folder or a search,
 * the same tiers lead the list instead (`documents-page.tsx`), so nothing is
 * listed twice on one screen.
 */
export function MarkedStrip({
  pinned,
  starred,
  marks,
  gate,
  onOpenFolder,
  onOpenDocument,
}: {
  pinned: readonly MarkedItem[];
  starred: readonly MarkedItem[];
  marks: DocumentMarks;
  gate: SubscriptionGate;
  onOpenFolder: (name: string) => void;
  onOpenDocument: (doc: ChapterDocument) => void;
}) {
  if (pinned.length === 0 && starred.length === 0) return null;
  return (
    <div className="space-y-4">
      {[
        { id: "doc-pinned-label", label: "Pinned", items: pinned },
        { id: "doc-starred-label", label: "Starred", items: starred },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.id} aria-labelledby={group.id}>
            <SectionLabel id={group.id}>{group.label}</SectionLabel>
            <ul className="grid grid-cols-1 gap-2 pt-2 @md:grid-cols-2 @3xl:grid-cols-3">
              {group.items.map((item) => (
                <MarkedCard
                  key={`${item.kind}:${item.kind === "folder" ? item.folder.id : item.doc.id}`}
                  item={item}
                  pinnedGroup={group.label === "Pinned"}
                  marks={marks}
                  gate={gate}
                  onOpenFolder={onOpenFolder}
                  onOpenDocument={onOpenDocument}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function MarkedCard({
  item,
  pinnedGroup,
  marks,
  gate,
  onOpenFolder,
  onOpenDocument,
}: {
  item: MarkedItem;
  pinnedGroup: boolean;
  marks: DocumentMarks;
  gate: SubscriptionGate;
  onOpenFolder: (name: string) => void;
  onOpenDocument: (doc: ChapterDocument) => void;
}) {
  const target =
    item.kind === "folder"
      ? ({ kind: "folder", id: item.folder.id } as const)
      : ({ kind: "document", id: item.doc.id } as const);
  const name = item.kind === "folder" ? item.folder.name : item.doc.title;
  const starred = marks.isStarred(target);
  const meta =
    item.kind === "folder"
      ? `Folder · ${item.count} ${item.count === 1 ? "file" : "files"}`
      : [
          item.doc.document_type,
          `Uploaded ${formatDay(item.doc.created_at)}`,
          item.doc.folder,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <li className="flex min-h-14 items-center gap-1 rounded-xl border border-border bg-card pr-1 transition-colors hover:bg-card-hover">
      {/*
        The card's body is one button, as a document row's name is: the whole
        name is the target. The star sits beside it, never inside it.
      */}
      <button
        type="button"
        onClick={() =>
          item.kind === "folder"
            ? onOpenFolder(item.folder.name)
            : onOpenDocument(item.doc)
        }
        {...(item.kind === "document"
          ? { [OPEN_DOCUMENT_ATTRIBUTE]: item.doc.id }
          : {})}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2.5 pl-4 text-left",
          FOCUS_RING,
        )}
      >
        {/*
          The accent duotone marks what the chapter pinned, as s12's PINNED
          cards draw it; a starred card takes the neutral glyph, so the two
          groups read apart before their labels are read.
        */}
        {item.kind === "folder" ? (
          <FolderGlyph
            className={cn(
              "h-5 w-5 shrink-0",
              pinnedGroup ? "text-accent-text" : "text-muted",
            )}
            active={pinnedGroup}
          />
        ) : (
          <DocumentsGlyph
            className={cn(
              "h-5 w-5 shrink-0",
              pinnedGroup ? "text-accent-text" : "text-muted",
            )}
            active={pinnedGroup}
          />
        )}
        <span className="block min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-caption text-muted">{meta}</span>
        </span>
      </button>
      <IconButton
        label={starred ? `Unstar ${name}` : `Star ${name}`}
        aria-pressed={starred}
        className={starred ? "text-accent-text" : undefined}
        onClick={() => marks.toggleStar(target, name)}
        {...gate.controlProps()}
      >
        <StarGlyph active={starred} />
      </IconButton>
    </li>
  );
}
