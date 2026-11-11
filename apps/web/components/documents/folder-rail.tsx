"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { tierByMarks } from "@repo/hooks/document-library";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Can } from "@/components/shared/can";
import {
  DocumentsGlyph,
  FolderGlyph,
  PinGlyph,
  StarGlyph,
} from "@/components/documents/resources-glyphs";
import {
  splitPinned,
  type FolderManagement,
} from "@/components/documents/folder-management";
import type { DocumentMarks } from "@/components/documents/use-document-marks";
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
 * deleted. Hover takes the neutral `--card-hover`; the active folder takes
 * `accent-4` plus `accent-11` text, because it is where the member is
 * (`foundations.md` §6, "Where the accent goes").
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
      : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
  ].join(" ");
}

/**
 * The five management icons (pin, up, down, rename, delete). A disabled one
 * (the first folder's Move up, the last one's Move down) keeps the quiet look rather than `button.tsx`'s
 * disabled card fill, which drew a boxed arrow in the middle of the rail.
 */
const MANAGE_CONTROL =
  "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 disabled:border-transparent disabled:bg-transparent";

export function FolderRail({
  railFolders,
  activeFolder,
  setActiveFolder,
  gate,
  management,
  marks,
  loadFailed,
  onRetryLoad,
}: {
  railFolders: FolderRow[];
  activeFolder: string | null;
  setActiveFolder: (folder: string | null) => void;
  gate: SubscriptionGate;
  management: FolderManagement;
  /** Pins and the member's own stars (#3934). */
  marks: DocumentMarks;
  /** The folder endpoint failed, so `railFolders` is the derived fallback. */
  loadFailed: boolean;
  onRetryLoad: () => void;
}) {
  const { folderBusy, openFolderDialog } = management;
  /*
    Folder management is a mode, not furniture. Every named folder used to
    carry a second line of four icon buttons (up, down, rename, delete), so an
    officer's rail read as a toolbar repeated six times and a member's rail
    could never look like the navigation it is. Edit shows those lines; Done
    puts them away. Toggling is not a write, so it is not gated; the five
    controls it reveals still are, each with its own explanation.
  */
  const [editing, setEditing] = useState(false);
  const manageable = railFolders.some((folder) => folder.id);

  /*
    The three tiers (#3934, `chapter-docs.md` § Pinned and starred): pinned
    for the chapter, then this member's stars, then the rest, each in the
    officers' order. Edit shows the chapter's arrangement instead, pinned and
    the rest, because that is what Move up and Move down change for everyone;
    one officer's stars are not part of it.
  */
  const groups: { label: string | null; folders: FolderRow[] }[] = (() => {
    if (editing) {
      const { pinned, rest } = splitPinned(railFolders);
      return pinned.length > 0
        ? [
            { label: "Pinned", folders: pinned },
            { label: "Other folders", folders: rest },
          ]
        : [{ label: null, folders: rest }];
    }
    const { pinned, starred, rest } = tierByMarks(
      railFolders,
      (folder) => !!folder.pinned_at,
      (folder) =>
        !!folder.id && marks.isStarred({ kind: "folder", id: folder.id }),
    );
    if (pinned.length === 0 && starred.length === 0) {
      return [{ label: null, folders: rest }];
    }
    return [
      { label: "Pinned", folders: pinned },
      { label: "Starred", folders: starred },
      { label: "Other folders", folders: rest },
    ].filter((group) => group.folders.length > 0);
  })();

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
          <div className="flex items-center gap-0.5">
            {manageable ? (
              <Button
                variant="ghost"
                size="toolbar"
                className="px-2 pointer-coarse:px-3"
                aria-pressed={editing}
                aria-label={editing ? "Done editing folders" : "Edit folders"}
                onClick={() => setEditing((current) => !current)}
              >
                {editing ? "Done" : "Edit"}
              </Button>
            ) : null}
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
          </div>
        </Can>
      </div>
      {/*
        The two filter rows stay ungated — they are client-side filters over
        the loaded list, not writes. The per-folder management controls
        beside each named row are gated, because those *are* the folder
        write routes (`chapter_docs:manage`, no `@FreeTier`). A star is a
        write too, the member's own, so it takes the same gate.
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
        {groups.map((group) => (
          <div
            key={group.label ?? "folders"}
            role={group.label ? "group" : undefined}
            aria-label={group.label ?? undefined}
          >
            {group.label ? (
              <p
                aria-hidden
                className={`${EYEBROW} px-2 pb-0.5 pt-3 text-muted-foreground`}
              >
                {group.label}
              </p>
            ) : null}
            {group.folders.map((folder, index) => (
              <FolderItem
                key={folder.id ?? `derived:${folder.name}`}
                folder={folder}
                active={activeFolder === folder.name}
                onSelect={() => setActiveFolder(folder.name)}
                editing={editing}
                first={index === 0}
                last={index === group.folders.length - 1}
                gate={gate}
                management={management}
                marks={marks}
              />
            ))}
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
            Couldn&apos;t load the folder list, so these are read from the
            documents shown. Empty folders and folder management are
            unavailable until it loads.{" "}
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

/**
 * One named folder: the row that filters to it, the member's star beside it,
 * and, in Edit, the officer's management line under it.
 */
function FolderItem({
  folder,
  active,
  onSelect,
  editing,
  first,
  last,
  gate,
  management,
  marks,
}: {
  folder: FolderRow;
  active: boolean;
  onSelect: () => void;
  editing: boolean;
  first: boolean;
  last: boolean;
  gate: SubscriptionGate;
  management: FolderManagement;
  marks: DocumentMarks;
}) {
  const { folderBusy, openFolderDialog, handleMoveFolder, handleDeleteFolder } =
    management;
  const id = folder.id;
  const pinned = !!folder.pinned_at;
  const starred = !!id && marks.isStarred({ kind: "folder", id });
  return (
    <div>
      <div className="group/folder flex items-center gap-0.5">
        <button
          type="button"
          onClick={onSelect}
          className={`${folderRowClassName(active)} min-w-0 flex-1`}
        >
          <FolderGlyph className="h-4 w-4 shrink-0" active={active} />
          <span className="truncate">{folder.name}</span>
        </button>
        {/*
          The star sits beside the row, not inside it: a button in a button
          is invalid, and the row's click is "open this folder". It shows on
          hover or focus, as Slack's sidebar star does, and stays drawn while
          the folder is starred so the mark reads at a glance. A finger has
          no hover, so a coarse pointer always sees it. A derived row (no
          record, `id === null`) has nothing to star.
        */}
        {id && !editing ? (
          <IconButton
            label={starred ? `Unstar ${folder.name}` : `Star ${folder.name}`}
            aria-pressed={starred}
            className={
              starred
                ? "text-accent-text"
                : "opacity-0 focus-visible:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100"
            }
            onClick={() =>
              marks.toggleStar({ kind: "folder", id }, folder.name)
            }
            {...gate.controlProps()}
          >
            <StarGlyph active={starred} />
          </IconButton>
        ) : null}
      </div>
      {/*
        `id === null` means this name was recovered from the documents
        because the folder endpoint is down — there is no record to
        rename, reorder or delete, so the row filters and nothing more.
      */}
      {id && editing ? (
        <Can permission="chapter_docs:manage">
          {/*
            A second line under the name rather than a trailing cluster
            on the same row: at the rail's 200px these controls cannot sit
            beside a folder name and still clear §2's 44px touch floor, and
            shrinking them below it is what `button.tsx`'s `icon` size exists
            to prevent. It wraps to a second line under a finger, where five
            44px controls are wider than the rail. Five controls also do not
            earn a popover, and hiding them behind one gated trigger would
            lose the per-control disabled explanation §5 rule 4 asks for.
          */}
          <div className="flex flex-wrap items-center justify-end gap-0.5 pb-1 pl-6">
            <Button
              variant="ghost"
              size="icon"
              className={`${MANAGE_CONTROL} ${pinned ? "text-accent-text" : ""}`}
              aria-label={
                pinned
                  ? `Unpin ${folder.name} for the chapter`
                  : `Pin ${folder.name} for the chapter`
              }
              aria-pressed={pinned}
              onClick={() =>
                void marks.setPinned(
                  { kind: "folder", id },
                  folder.name,
                  !pinned,
                )
              }
              {...gate.controlProps(folderBusy || marks.pinBusy)}
            >
              <PinGlyph className="h-4 w-4" active={pinned} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MANAGE_CONTROL}
              aria-label={`Move ${folder.name} up`}
              onClick={() => void handleMoveFolder(id, -1)}
              {...gate.controlProps(folderBusy || first)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MANAGE_CONTROL}
              aria-label={`Move ${folder.name} down`}
              onClick={() => void handleMoveFolder(id, 1)}
              {...gate.controlProps(folderBusy || last)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MANAGE_CONTROL}
              aria-label={`Rename ${folder.name}`}
              onClick={() => openFolderDialog(folder)}
              {...gate.controlProps(folderBusy)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MANAGE_CONTROL}
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
  );
}
