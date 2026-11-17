import { DOCUMENT_FOLDER_PATH_SEPARATOR as FOLDER_PATH_SEPARATOR } from "@repo/validation";

/**
 * Documents' folders drawn as a tree (#5337, Shawn's pick of option C).
 *
 * Folders don't nest in the data: a chapter's folders are one flat list, and
 * Google Drive sync names a subfolder by its path ("Chapter files / Rush /
 * 2024", `chapter-docs.md` § Google Drive folder). This reads that list as a
 * tree for the folder rail on web and the folder chips on the phone, so a
 * synced Drive tree reads the way it does in Drive, without changing what is
 * stored, who can see what, or which files a folder holds.
 *
 * A folder sits under another only when the other is a folder this member
 * has: its parent is the longest name that is its own name cut at a
 * `DOCUMENT_FOLDER_PATH_SEPARATOR` (" / "). Nothing is invented, so:
 *
 * - every row is a real folder that opens its own files, never a heading;
 * - a folder whose parent the member can't see, or that sync left out, sits
 *   under the nearest folder above it that they have, or at the top, reading
 *   the rest of its own name ("Rush / 2024"). It shows no more of a hidden
 *   folder's name than its own name already does;
 * - a name an officer typed with " / " in it ("Rush / Recruitment") stays one
 *   row unless a folder named "Rush" exists, in which case it reads as one of
 *   Rush's, as the officer most likely meant.
 *
 * Kept free of React, like `document-library.ts`, so both apps run the same
 * rule over plain rows.
 */

export type FolderTreeNode<F> = {
  folder: F;
  /** The row's own name: the part of the folder's name past its parent's. */
  label: string;
  /**
   * The name of the folder this one sits under, or `null` at the top. Shown
   * under a folder drawn away from its place (Pinned, Starred) so two
   * "Flyers" read apart.
   */
  parentName: string | null;
  /** Folders under this one, in the list's order. */
  children: FolderTreeNode<F>[];
  /** The folder's place in the list it was built from, for re-sorting. */
  index: number;
};

/**
 * The tree, in the order of `folders` (the officers' order): a parent's
 * children keep their order among themselves, and the top level keeps its.
 */
export function buildFolderTree<F extends { name: string }>(
  folders: readonly F[],
): FolderTreeNode<F>[] {
  const byName = new Map<string, FolderTreeNode<F>>();
  const nodes = folders.map((folder, index) => {
    const node: FolderTreeNode<F> = {
      folder,
      label: folder.name,
      parentName: null,
      children: [],
      index,
    };
    // Names are unique within a chapter; a duplicate would only come from
    // the derived fallback, which dedupes, so the first one wins.
    if (!byName.has(folder.name)) byName.set(folder.name, node);
    return node;
  });

  const roots: FolderTreeNode<F>[] = [];
  for (const node of nodes) {
    const parent = nearestParent(node.folder.name, byName);
    if (parent && parent !== node) {
      node.parentName = parent.folder.name;
      node.label = node.folder.name.slice(
        parent.folder.name.length + FOLDER_PATH_SEPARATOR.length,
      );
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function nearestParent<N>(
  name: string,
  byName: { get: (name: string) => N | undefined },
): N | null {
  let cut = name.lastIndexOf(FOLDER_PATH_SEPARATOR);
  while (cut > 0) {
    const parent = byName.get(name.slice(0, cut));
    if (parent) return parent;
    cut = name.lastIndexOf(FOLDER_PATH_SEPARATOR, cut - 1);
  }
  return null;
}

/**
 * Where one folder sits, for a card or chip drawn away from the tree: its own
 * name and the folder it sits under, by the same rule as
 * {@link buildFolderTree}. `names` is every folder the member has.
 */
export function folderPlace(
  name: string,
  names: ReadonlySet<string>,
): { label: string; parentName: string | null } {
  const parentName = nearestParent(name, {
    get: (candidate) => (names.has(candidate) ? candidate : undefined),
  });
  if (!parentName) return { label: name, parentName: null };
  return {
    label: name.slice(parentName.length + FOLDER_PATH_SEPARATOR.length),
    parentName,
  };
}

/** The nodes from the top down to `name`'s, or null when it isn't drawn. */
function pathTo<F extends { name: string }>(
  forest: readonly FolderTreeNode<F>[],
  name: string,
): FolderTreeNode<F>[] | null {
  for (const node of forest) {
    if (node.folder.name === name) return [node];
    const below = pathTo(node.children, name);
    if (below) return [node, ...below];
  }
  return null;
}

/**
 * The folders drawn above `name`, outermost first: the ones to keep open so
 * `name` shows. `forest` is what is drawn (the tiers from
 * {@link liftMarkedFolders}, or the tree), so a pinned folder lifted to the
 * top has none. Empty for a top-level folder or one not drawn.
 */
export function folderAncestors<F extends { name: string }>(
  forest: readonly FolderTreeNode<F>[],
  name: string,
): F[] {
  return (pathTo(forest, name) ?? []).slice(0, -1).map((node) => node.folder);
}

/**
 * Pinned and starred folders lifted out of the tree (#3934's tiers over a
 * tree): each marked folder moves to its tier with everything under it, and
 * leaves its place in the rest. Pinned beats starred, as on a flat list, and
 * shows once: a folder inside a pinned one stays there whatever its marks; a
 * pinned folder inside a starred one is lifted to Pinned. Each tier is in the
 * officers' order, as the flat tiers were.
 */
export function liftMarkedFolders<F extends { name: string }>(
  tree: readonly FolderTreeNode<F>[],
  isPinned: (folder: F) => boolean,
  isStarred: (folder: F) => boolean,
): {
  pinned: FolderTreeNode<F>[];
  starred: FolderTreeNode<F>[];
  rest: FolderTreeNode<F>[];
} {
  const pinned: FolderTreeNode<F>[] = [];
  const starred: FolderTreeNode<F>[] = [];
  const walk = (
    nodes: readonly FolderTreeNode<F>[],
    inPinned: boolean,
    inStarred: boolean,
  ): FolderTreeNode<F>[] => {
    const kept: FolderTreeNode<F>[] = [];
    for (const node of nodes) {
      if (inPinned) {
        kept.push(node);
      } else if (isPinned(node.folder)) {
        pinned.push(node);
      } else if (!inStarred && isStarred(node.folder)) {
        starred.push({
          ...node,
          children: walk(node.children, false, true),
        });
      } else {
        kept.push({
          ...node,
          children: walk(node.children, false, inStarred),
        });
      }
    }
    return kept;
  };
  const rest = walk(tree, false, false);
  const byIndex = (a: FolderTreeNode<F>, b: FolderTreeNode<F>) =>
    a.index - b.index;
  return { pinned: pinned.sort(byIndex), starred: starred.sort(byIndex), rest };
}

/**
 * One level of the tree, for the phone's folder chips (#5337), which show a
 * level at a time and step in and out of folders, as the Files app and Google
 * Drive's phone app walk a tree, rather than indenting a sideways row.
 *
 * `forest` is what the chips draw at the top (pinned, starred, then the rest,
 * from {@link liftMarkedFolders}). With `selected` a folder that holds others,
 * the level is that folder; with a folder that holds none, the level is the
 * folder it sits in, so its siblings stay in reach. `level` is `null` at the
 * top. `up` is the folder one level out, the chip that steps back (`null`
 * for the top, where the step back is All).
 */
export function folderLevel<F extends { name: string }>(
  forest: readonly FolderTreeNode<F>[],
  selected: string | null,
): {
  level: FolderTreeNode<F> | null;
  up: FolderTreeNode<F> | null;
  items: readonly FolderTreeNode<F>[];
} {
  const top = { level: null, up: null, items: forest };
  if (selected === null) return top;
  const path = pathTo(forest, selected);
  if (!path) return top;
  const node = path[path.length - 1]!;
  const levelAt = node.children.length > 0 ? path.length - 1 : path.length - 2;
  const level = path[levelAt];
  if (!level) return top;
  return { level, up: path[levelAt - 1] ?? null, items: level.children };
}

/**
 * A folder card's title and meta line (#3934 cards, #5337), both apps: its own
 * name, and where it sits when it sits under another folder the member has,
 * since a synced folder's whole path would truncate before its own name.
 */
export function folderCardText(
  name: string,
  fileCount: number,
  names: ReadonlySet<string>,
): { title: string; meta: string; where: string | null } {
  const place = folderPlace(name, names);
  const files = `${fileCount} ${fileCount === 1 ? "file" : "files"}`;
  return {
    title: place.label,
    meta: place.parentName
      ? `In ${place.parentName} · ${files}`
      : `Folder · ${files}`,
    where: place.parentName,
  };
}

/**
 * Whether a folder with children starts open before the member opens or
 * closes it: only when it is the one folder at its level, so a connected Drive
 * folder ("Chapter files", alone at the top) shows what is in it rather than
 * a single closed row, and a wide level stays short.
 */
export function folderStartsOpen(siblingCount: number): boolean {
  return siblingCount === 1;
}
