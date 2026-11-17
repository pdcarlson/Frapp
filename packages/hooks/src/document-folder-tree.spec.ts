import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  findFolderNode,
  folderAncestors,
  folderLevel,
  folderPlace,
  folderStartsOpen,
  liftMarkedFolders,
  type FolderTreeNode,
} from "./document-folder-tree";

type F = { name: string; pinned?: boolean; starred?: boolean };
const f = (name: string, marks: Partial<F> = {}): F => ({ name, ...marks });

/** The tree as indented labels, so a case reads as the rail would. */
function outline(nodes: readonly FolderTreeNode<F>[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${"  ".repeat(depth)}${node.label}`,
    ...outline(node.children, depth + 1),
  ]);
}

const FIJI = [
  f("Town in Fiji"),
  f("Town in Fiji / Rush"),
  f("Town in Fiji / Rush / 2024"),
  f("Town in Fiji / Rush / 2024 / Flyers"),
  f("Town in Fiji / Rush / 2025"),
  f("Town in Fiji / Formal"),
  f("Bylaws"),
];

describe("buildFolderTree", () => {
  it("draws a synced Drive tree under its parents, each row its own name", () => {
    expect(outline(buildFolderTree(FIJI))).toEqual([
      "Town in Fiji",
      "  Rush",
      "    2024",
      "      Flyers",
      "    2025",
      "  Formal",
      "Bylaws",
    ]);
  });

  it("keeps the officers' order at every level, whatever order parents come in", () => {
    const tree = buildFolderTree([
      f("Rush / Shirts"),
      f("Bylaws"),
      f("Rush"),
      f("Rush / Flyers"),
    ]);
    expect(outline(tree)).toEqual(["Bylaws", "Rush", "  Shirts", "  Flyers"]);
  });

  it("names each folder's parent for a row drawn away from its place", () => {
    const tree = buildFolderTree(FIJI);
    expect(
      findFolderNode(tree, "Town in Fiji / Rush / 2024 / Flyers")?.parentName,
    ).toBe("Town in Fiji / Rush / 2024");
    expect(findFolderNode(tree, "Bylaws")?.parentName).toBeNull();
  });

  it("puts a folder whose parent the member can't see under the nearest one they can, reading the rest of its name", () => {
    // "Town in Fiji / Rush" is hidden from this member (its own list).
    const tree = buildFolderTree([
      f("Town in Fiji"),
      f("Town in Fiji / Rush / 2024"),
      f("Town in Fiji / Formal"),
    ]);
    expect(outline(tree)).toEqual([
      "Town in Fiji",
      "  Rush / 2024",
      "  Formal",
    ]);
  });

  it("invents no row: with no folder above it, a folder stays at the top under its whole name", () => {
    const tree = buildFolderTree([
      f("Town in Fiji / Rush"),
      f("Town in Fiji / Rush / 2024"),
      f("Town in Fiji / Formal"),
    ]);
    expect(outline(tree)).toEqual([
      "Town in Fiji / Rush",
      "  2024",
      "Town in Fiji / Formal",
    ]);
  });

  it("leaves a typed name holding ' / ' as one row when nothing is named by its first part", () => {
    expect(
      outline(buildFolderTree([f("Rush / Recruitment"), f("Bylaws")])),
    ).toEqual(["Rush / Recruitment", "Bylaws"]);
  });

  it("nests by whole parts, not by a name that merely starts the same", () => {
    expect(
      outline(buildFolderTree([f("Rush"), f("Rush 2024"), f("Rushes / A")])),
    ).toEqual(["Rush", "Rush 2024", "Rushes / A"]);
  });

  it("follows a shortened Drive path where its parent exists, and stays whole where it doesn't", () => {
    const tree = buildFolderTree([
      f("Chapter files"),
      f("Chapter files / … / 2025"),
      f("Chapter files / … / 2025 / Flyers"),
    ]);
    expect(outline(tree)).toEqual([
      "Chapter files",
      "  … / 2025",
      "    Flyers",
    ]);
  });

  it("finds the folders to open so one shows", () => {
    const tree = buildFolderTree(FIJI);
    expect(
      folderAncestors(tree, "Town in Fiji / Rush / 2024 / Flyers"),
    ).toEqual([
      "Town in Fiji",
      "Town in Fiji / Rush",
      "Town in Fiji / Rush / 2024",
    ]);
    expect(folderAncestors(tree, "Bylaws")).toEqual([]);
    expect(folderAncestors(tree, "Not a folder")).toEqual([]);
  });
});

describe("liftMarkedFolders", () => {
  const lift = (folders: F[]) =>
    liftMarkedFolders(
      buildFolderTree(folders),
      (folder) => !!folder.pinned,
      (folder) => !!folder.starred,
    );

  it("moves a marked folder to its tier with everything under it", () => {
    const tiers = lift([
      f("Town in Fiji"),
      f("Town in Fiji / Rush", { pinned: true }),
      f("Town in Fiji / Rush / 2024"),
      f("Town in Fiji / Formal", { starred: true }),
      f("Bylaws"),
    ]);
    expect(outline(tiers.pinned)).toEqual(["Rush", "  2024"]);
    expect(outline(tiers.starred)).toEqual(["Formal"]);
    expect(outline(tiers.rest)).toEqual(["Town in Fiji", "Bylaws"]);
  });

  it("shows a folder once: one inside a pinned folder stays there, marked or not", () => {
    const tiers = lift([
      f("Rush", { pinned: true }),
      f("Rush / 2024", { pinned: true, starred: true }),
    ]);
    expect(outline(tiers.pinned)).toEqual(["Rush", "  2024"]);
    expect(tiers.starred).toEqual([]);
    expect(tiers.rest).toEqual([]);
  });

  it("lifts a pinned folder out of a starred one, as pinned beats starred", () => {
    const tiers = lift([
      f("Rush", { starred: true }),
      f("Rush / 2024", { pinned: true }),
      f("Rush / 2025"),
    ]);
    expect(outline(tiers.pinned)).toEqual(["2024"]);
    expect(outline(tiers.starred)).toEqual(["Rush", "  2025"]);
  });

  it("keeps each tier in the officers' order, not the tree's", () => {
    const tiers = lift([
      f("Rush"),
      f("Bylaws", { pinned: true }),
      f("Rush / Flyers", { pinned: true }),
    ]);
    expect(tiers.pinned.map((node) => node.folder.name)).toEqual([
      "Bylaws",
      "Rush / Flyers",
    ]);
  });

  it("leaves a flat list's tiers as they were", () => {
    const tiers = lift([
      f("Bylaws"),
      f("Minutes", { pinned: true }),
      f("Rush", { starred: true }),
      f("Formal"),
    ]);
    expect(outline(tiers.pinned)).toEqual(["Minutes"]);
    expect(outline(tiers.starred)).toEqual(["Rush"]);
    expect(outline(tiers.rest)).toEqual(["Bylaws", "Formal"]);
  });
});

describe("folderStartsOpen", () => {
  it("opens only a folder alone at its level", () => {
    expect(folderStartsOpen(1)).toBe(true);
    expect(folderStartsOpen(2)).toBe(false);
  });
});

describe("folderPlace", () => {
  const names = new Set(FIJI.map((folder) => folder.name));
  it("names a folder by its own name and the folder it sits under, as the tree does", () => {
    expect(folderPlace("Town in Fiji / Rush / 2024 / Flyers", names)).toEqual({
      label: "Flyers",
      parentName: "Town in Fiji / Rush / 2024",
    });
    expect(folderPlace("Bylaws", names)).toEqual({
      label: "Bylaws",
      parentName: null,
    });
    expect(folderPlace("Rush / Recruitment", names)).toEqual({
      label: "Rush / Recruitment",
      parentName: null,
    });
  });
});

describe("folderLevel", () => {
  const forest = buildFolderTree(FIJI);
  const names = (level: ReturnType<typeof folderLevel<F>>) => ({
    level: level.level?.label ?? null,
    up: level.up?.label ?? null,
    items: level.items.map((node) => node.label),
  });

  it("is the top with nothing chosen, or a folder that isn't there", () => {
    expect(names(folderLevel(forest, null))).toEqual({
      level: null,
      up: null,
      items: ["Town in Fiji", "Bylaws"],
    });
    expect(names(folderLevel(forest, "Gone"))).toEqual(
      names(folderLevel(forest, null)),
    );
  });

  it("steps into a folder that holds others", () => {
    expect(names(folderLevel(forest, "Town in Fiji / Rush"))).toEqual({
      level: "Rush",
      up: "Town in Fiji",
      items: ["2024", "2025"],
    });
    expect(names(folderLevel(forest, "Town in Fiji"))).toEqual({
      level: "Town in Fiji",
      up: null,
      items: ["Rush", "Formal"],
    });
  });

  it("keeps a folder that holds none among its siblings", () => {
    expect(names(folderLevel(forest, "Town in Fiji / Rush / 2025"))).toEqual({
      level: "Rush",
      up: "Town in Fiji",
      items: ["2024", "2025"],
    });
    expect(names(folderLevel(forest, "Bylaws"))).toEqual(
      names(folderLevel(forest, null)),
    );
  });
});
