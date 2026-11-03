"use client";

import {
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/shared/can";
import {
  DocumentsGlyph,
  FolderGlyph,
} from "@/components/documents/resources-glyphs";
import type { FolderManagement } from "@/components/documents/folder-management";
import type { FolderRow } from "@/components/documents/document-types";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { compactControlClassName } from "@/components/shared/table-controls";

/**
 * The folder rail's row recipe, written once.
 *
 * Three buttons render it — "All files", "No folder", and each named folder —
 * and it was spelled out three times, so the `pointer-coarse` touch-target fix
 * needed three synchronised edits and nothing would have caught a fourth row
 * drifting.
 *
 * §2's two row states rather than §7's sidebar item. §7 defines one active fill
 * and a hover that falls back to the card, which was unusable when this rail
 * sat *on* a card — and is still the wrong pick now that the card is gone and
 * the rail sits on `--background`, because §7's fallback would paint the rail
 * a step lighter than the list beside it and rebuild the panel this lane
 * deleted. Hover takes `accent-3`, active `accent-4` plus `accent-11` text —
 * the table recipe `components/shared/table-contrast.spec.ts` pins.
 * `FOCUS_RING_OFFSET`, not `FOCUS_RING`: these rows carry no border, and
 * `FOCUS_RING`'s indicator is the border swap.
 */
function folderRowClassName(isActive: boolean): string {
  return [
    "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
    "pointer-coarse:min-h-11",
    FOCUS_RING_OFFSET,
    isActive
      ? "bg-accent-subtle-hover text-accent-text"
      : "text-muted-foreground hover:bg-accent-subtle hover:text-foreground",
  ].join(" ");
}

export function FolderRail({
  railFolders,
  activeFolder,
  setActiveFolder,
  gate,
  management,
  loadFailed,
  searching,
  onRetryLoad,
}: {
  railFolders: FolderRow[];
  activeFolder: string | null;
  setActiveFolder: (folder: string | null) => void;
  gate: SubscriptionGate;
  management: FolderManagement;
  /** The folder endpoint failed, so `railFolders` is the derived fallback. */
  loadFailed: boolean;
  searching: boolean;
  onRetryLoad: () => void;
}) {
  const { folderBusy, openFolderDialog, handleMoveFolder, handleDeleteFolder } =
    management;

  return (
    <nav aria-labelledby="doc-folders-label">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h2
          id="doc-folders-label"
          className={`${EYEBROW} text-muted-foreground`}
        >
          Folders
        </h2>
        <Can permission="chapter_docs:manage">
          <Button
            variant="ghost"
            size="icon"
            className={compactControlClassName}
            aria-label="New folder"
            onClick={() => openFolderDialog(null)}
            {...gate.controlProps(folderBusy)}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </Can>
      </div>
      {/*
        The two filter rows stay ungated — they are client-side filters over
        the loaded list, not writes. The per-folder management controls
        beside each named row are gated, because those *are* the folder
        write routes (`chapter_docs:manage`, no `@FreeTier`).
      */}
      <div className="space-y-0.5 pt-1">
        <button
          type="button"
          onClick={() => setActiveFolder(null)}
          className={folderRowClassName(activeFolder === null)}
        >
          <FolderGlyph className="h-4 w-4" active={activeFolder === null} /> All
          files
        </button>
        <button
          type="button"
          onClick={() => setActiveFolder("")}
          className={folderRowClassName(activeFolder === "")}
        >
          <DocumentsGlyph className="h-4 w-4" active={activeFolder === ""} /> No
          folder
        </button>
        {railFolders.map((folder, index) => (
          <div key={folder.id ?? `derived:${folder.name}`}>
            <button
              type="button"
              onClick={() => setActiveFolder(folder.name)}
              className={folderRowClassName(activeFolder === folder.name)}
            >
              <FolderGlyph
                className="h-4 w-4 shrink-0"
                active={activeFolder === folder.name}
              />
              <span className="truncate">{folder.name}</span>
            </button>
            {/*
              `id === null` means this name was recovered from the documents
              because the folder endpoint is down — there is no record to
              rename, reorder or delete, so the row filters and nothing more.
            */}
            {folder.id ? (
              <Can permission="chapter_docs:manage">
                {/*
                  A second line under the name rather than a trailing cluster
                  on the same row: at the rail's 200px these four controls
                  cannot sit beside a folder name and still clear §2's
                  44px touch floor, and shrinking them below it is what
                  `button.tsx`'s `icon` size exists to prevent. Four controls
                  also do not earn a popover, and hiding them behind one
                  gated trigger would lose the per-control disabled
                  explanation §5 rule 4 asks for.
                */}
                <div className="flex items-center justify-end gap-0.5 pb-1 pl-6">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                    aria-label={`Move ${folder.name} up`}
                    onClick={() => void handleMoveFolder(index, -1)}
                    {...gate.controlProps(folderBusy || index === 0)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                    aria-label={`Move ${folder.name} down`}
                    onClick={() => void handleMoveFolder(index, 1)}
                    {...gate.controlProps(
                      folderBusy || index === railFolders.length - 1,
                    )}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                    aria-label={`Rename ${folder.name}`}
                    onClick={() => openFolderDialog(folder)}
                    {...gate.controlProps(folderBusy)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
                    aria-label={`Delete folder ${folder.name}`}
                    onClick={() => void handleDeleteFolder(folder)}
                    {...gate.controlProps(folderBusy)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Can>
            ) : null}
          </div>
        ))}
        {/*
          Said once, under the rail, rather than replacing it: the names
          above are the pre-#791 derived fallback and still filter correctly,
          so the honest report is that management is unavailable — not that
          the chapter has no folders.
        */}
        {loadFailed ? (
          <p className="px-2 pt-2 text-xs text-muted-foreground">
            {searching
              ? "Couldn't load the folder list, so folder filters are unavailable while searching. Clear the search to get them back."
              : "Couldn't load the folder list, so these are read from the documents shown. Empty folders and folder management are unavailable until it loads."}{" "}
            <button
              type="button"
              className={`underline ${FOCUS_RING_OFFSET}`}
              onClick={onRetryLoad}
            >
              Retry
            </button>
          </p>
        ) : null}
      </div>
    </nav>
  );
}
