"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  buildFolderTree,
  folderAncestors,
  folderStartsOpen,
  liftMarkedFolders,
  type FolderTreeNode,
} from "@repo/hooks/document-folder-tree";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Can } from "@/components/shared/can";
import {
  DocumentsGlyph,
  FolderGlyph,
  PinGlyph,
  StarGlyph,
} from "@/components/documents/resources-glyphs";
import type { FolderManagement } from "@/components/documents/folder-management";
import { useFolderOpen } from "@/components/documents/use-folder-open";
import type { DocumentMarks } from "@/components/documents/use-document-marks";
import {
  KEEP_FOCUS_ATTRIBUTE,
  useKeepFocus,
} from "@/components/documents/use-keep-focus";
import type { FolderRow } from "@/components/documents/document-types";
import { LimitedMark } from "@/components/documents/document-access";
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
 * The five management icons (pin, up, down, edit, delete). A disabled one
 * (the first folder's Move up, the last one's Move down) keeps the quiet look rather than `button.tsx`'s
 * disabled card fill, which drew a boxed arrow in the middle of the rail.
 */
const MANAGE_CONTROL =
  "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 disabled:border-transparent disabled:bg-transparent";

/**
 * How far each level of the tree steps in (#5337), and the deepest level that
 * still steps: Drive sync reads ten levels, and ten steps would leave a 200px
 * rail no room for a name, so past the sixth a folder lines up with its
 * parent's level and the chevrons and order still say where it sits.
 */
const INDENT_PX = 12;
const MAX_INDENT_LEVELS = 6;

/** A folder's key for the open/closed picks: its id, or a derived row's name. */
function openKey(folder: FolderRow): string {
  return folder.id ?? `name:${folder.name}`;
}

type FolderNode = FolderTreeNode<FolderRow>;

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
  const { rootRef, remember } = useKeepFocus<HTMLElement>();

  /*
    The tree (#5337, Shawn's pick of option C): a folder named by its path
    ("Town in Fiji / Rush / 2024", as Drive sync names them) is drawn under
    its parent, reading its own name, as Google Drive's and Dropbox's
    sidebars and Notion's page tree draw theirs. The data stays flat; only
    the drawing nests (`document-folder-tree.ts` says which folder goes
    where, the phone's chips run the same rule).
  */
  const tree = useMemo(() => buildFolderTree(railFolders), [railFolders]);
  const nested = tree.some((node) => node.children.length > 0);
  const { isOpen, setOpen } = useFolderOpen();
  /*
    Opening a folder from anywhere else (a card, a file's folder) opens the
    folders above it, so the lit row is never hidden in a closed branch.
    Closing one afterwards is the member's call.
  */
  useEffect(() => {
    if (!activeFolder) return;
    const above = folderAncestors(tree, activeFolder);
    if (above.length === 0) return;
    const keys = above.flatMap((name) => {
      const folder = railFolders.find((entry) => entry.name === name);
      return folder ? [openKey(folder)] : [];
    });
    setOpen(keys, true);
  }, [activeFolder, tree, railFolders, setOpen]);

  /*
    The three tiers (#3934, `chapter-docs.md` § Pinned and starred): pinned
    for the chapter, then this member's stars, then the rest, each in the
    officers' order. A marked folder takes everything under it to its tier,
    so a folder shows once (`liftMarkedFolders`). Edit shows the chapter's
    arrangement instead, pinned and the rest, because that is what Move up
    and Move down change for everyone; one officer's stars are not part of it.
  */
  const groups: { label: string | null; nodes: FolderNode[] }[] = (() => {
    const tiers = liftMarkedFolders(
      tree,
      (folder) => !!folder.pinned_at,
      (folder) =>
        !editing &&
        !!folder.id &&
        marks.isStarred({ kind: "folder", id: folder.id }),
    );
    if (tiers.pinned.length === 0 && tiers.starred.length === 0) {
      return [{ label: null, nodes: tiers.rest }];
    }
    return [
      { label: "Pinned", nodes: tiers.pinned },
      { label: "Starred", nodes: tiers.starred },
      { label: "Other folders", nodes: tiers.rest },
    ].filter((group) => group.nodes.length > 0);
  })();

  const branch = {
    activeFolder,
    setActiveFolder,
    editing,
    nested,
    isOpen,
    setOpen,
    gate,
    management,
    marks,
    remember,
  };

  return (
    <nav ref={rootRef} aria-labelledby="doc-folders-label">
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
            <FolderBranch nodes={group.nodes} depth={0} {...branch} />
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
            documents shown. Empty folders and folder management are unavailable
            until it loads.{" "}
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

type BranchProps = {
  activeFolder: string | null;
  setActiveFolder: (folder: string | null) => void;
  editing: boolean;
  /** Some folder has folders under it, so every row keeps the chevron's column. */
  nested: boolean;
  isOpen: (key: string, startsOpen: boolean) => boolean;
  setOpen: (keys: readonly string[], open: boolean) => void;
  gate: SubscriptionGate;
  management: FolderManagement;
  marks: DocumentMarks;
  remember: (key: string) => void;
};

/**
 * One level of the tree: its folders, each followed by its own folders when
 * open. Nested lists, so assistive tech reads each level as a list inside
 * the one above, as it reads a nested outline.
 */
function FolderBranch({
  nodes,
  depth,
  ...branch
}: BranchProps & { nodes: FolderNode[]; depth: number }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node, index) => {
        const folder = node.folder;
        const key = openKey(folder);
        const hasChildren = node.children.length > 0;
        const open =
          hasChildren && branch.isOpen(key, folderStartsOpen(nodes.length));
        /*
          Move up and Move down step past the nearest folder beside this one
          at its own level, in its own tier: the tree draws each level in the
          stored order, and a pinned folder always sorts before the rest, so
          a step past one in the other tier would change nothing.
        */
        const pinned = !!folder.pinned_at;
        const sameTier = (other: FolderNode) =>
          !!other.folder.id && !!other.folder.pinned_at === pinned;
        const before = nodes.slice(0, index).reverse().find(sameTier);
        const after = nodes.slice(index + 1).find(sameTier);
        return (
          <li key={folder.id ?? `derived:${folder.name}`}>
            <FolderItem
              node={node}
              depth={depth}
              hasChildren={hasChildren}
              open={open}
              onToggle={() => branch.setOpen([key], !open)}
              active={branch.activeFolder === folder.name}
              onSelect={() => {
                branch.setActiveFolder(folder.name);
                // As Drive's sidebar does, choosing a folder also opens it.
                if (hasChildren && !open) branch.setOpen([key], true);
              }}
              moveBefore={before?.folder.id ?? null}
              moveAfter={after?.folder.id ?? null}
              {...branch}
            />
            {open ? (
              <FolderBranch
                nodes={node.children}
                depth={depth + 1}
                {...branch}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One named folder: the chevron that opens what is under it, the row that
 * filters to it, the member's star beside it, and, in Edit, the officer's
 * management line under it.
 */
function FolderItem({
  node,
  depth,
  hasChildren,
  open,
  onToggle,
  active,
  onSelect,
  editing,
  nested,
  moveBefore,
  moveAfter,
  gate,
  management,
  marks,
  remember,
}: {
  node: FolderNode;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  onToggle: () => void;
  active: boolean;
  onSelect: () => void;
  editing: boolean;
  nested: boolean;
  /** The folder Move up steps past, or null when it can't move up. */
  moveBefore: string | null;
  /** The folder Move down steps past, or null when it can't move down. */
  moveAfter: string | null;
  gate: SubscriptionGate;
  management: FolderManagement;
  marks: DocumentMarks;
  /** Keeps focus on a Star or Pin whose folder changes group. */
  remember: (key: string) => void;
}) {
  const { folderBusy, openFolderDialog, handleMoveFolder, handleDeleteFolder } =
    management;
  /*
    Moves wait for a pin to settle: the move works out the pinned group from
    `pinned_at`, which a pin in flight hasn't changed yet, so moving then
    would save an arrangement the pin is about to contradict.
  */
  const moveBusy = folderBusy || marks.pinBusy;
  const folder = node.folder;
  const id = folder.id;
  const pinned = !!folder.pinned_at;
  const starred = !!id && marks.isStarred({ kind: "folder", id });
  /*
    A folder drawn away from its place in the tree (at the top of Pinned or
    Starred) says where it lives under its own name, so two "Flyers" read
    apart, as Drive's Starred list names each item's location.
  */
  const where = depth === 0 ? node.parentName : null;
  return (
    <div>
      <div
        className="group/folder flex items-center gap-0.5"
        style={
          depth > 0
            ? { paddingLeft: Math.min(depth, MAX_INDENT_LEVELS) * INDENT_PX }
            : undefined
        }
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? "Close" : "Open"} ${folder.name}`}
            className={`flex h-9 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-card-hover hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-8 ${FOCUS_RING_OFFSET}`}
          >
            <ChevronRight
              aria-hidden
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : nested ? (
          <span aria-hidden className="w-6 shrink-0 pointer-coarse:w-8" />
        ) : null}
        <button
          type="button"
          onClick={onSelect}
          title={node.label === folder.name ? undefined : folder.name}
          className={`${folderRowClassName(active)} min-w-0 flex-1`}
        >
          <FolderGlyph className="h-4 w-4 shrink-0" active={active} />
          <span className="min-w-0">
            <span className="block truncate">{node.label}</span>
            {where ? (
              <span className="block truncate text-xs text-muted-foreground">
                {where}
              </span>
            ) : null}
          </span>
          {folder.who_can_see ? (
            <LimitedMark label="Not everyone can see this folder" />
          ) : null}
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
            {...{ [KEEP_FOCUS_ATTRIBUTE]: `star:${id}` }}
            onClick={() => {
              remember(`star:${id}`);
              marks.toggleStar({ kind: "folder", id }, folder.name);
            }}
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
              {...{ [KEEP_FOCUS_ATTRIBUTE]: `pin:${id}` }}
              onClick={() => {
                remember(`pin:${id}`);
                void marks.setPinned(
                  { kind: "folder", id },
                  folder.name,
                  !pinned,
                );
              }}
              {...gate.controlProps(folderBusy || marks.pinBusy)}
            >
              <PinGlyph className="h-4 w-4" active={pinned} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MANAGE_CONTROL}
              aria-label={`Move ${folder.name} up`}
              onClick={() =>
                moveBefore && void handleMoveFolder(id, moveBefore)
              }
              {...gate.controlProps(moveBusy || !moveBefore)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MANAGE_CONTROL}
              aria-label={`Move ${folder.name} down`}
              onClick={() => moveAfter && void handleMoveFolder(id, moveAfter)}
              {...gate.controlProps(moveBusy || !moveAfter)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={MANAGE_CONTROL}
              aria-label={`Edit ${folder.name}`}
              onClick={() => openFolderDialog(folder)}
              {...gate.controlProps(folderBusy)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {/*
              A folder Drive sync made (#5220) is deleted in Drive, and
              Documents follows; the API refuses it here.
            */}
            {folder.drive_folder_id ? null : (
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
            )}
          </div>
        </Can>
      ) : null}
    </div>
  );
}
