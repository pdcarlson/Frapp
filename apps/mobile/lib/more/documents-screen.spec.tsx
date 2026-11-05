/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #3399. s12 draws the board's upload glyph on its `‹ More` row only for a
 * viewer who holds `chapter_docs:upload`, the permission both upload routes
 * carry, so a member never meets a control the server would refuse.
 *
 * It renders `app/(tabs)/documents.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

let permissions: string[] = [];
let folderRows: unknown[] = [];
let chapterId: string | null = "chapter-a";
const LOADED = {
  data: [],
  isPending: false,
  isError: false,
  isFetching: false,
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePermissionList: () => permissions,
  useDocuments: () => LOADED,
  useDocumentFolders: () => ({ ...LOADED, data: folderRows }),
  useActiveChapterId: () => chapterId,
  useDocumentDownloadUrl: () => ({ mutateAsync: vi.fn() }),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmDocumentUpload: () => ({ mutateAsync: vi.fn() }),
}));

// A purple stand-in, so a glyph painted house gold (`gold.askText`) fails.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#7A3FC2" }),
}));

import DocumentsScreen from "@/app/(tabs)/documents";
import { UploadGlyph } from "@/components/documents/document-glyphs";

const present = vi.fn();
const mounted: ReactTestRenderer[] = [];

const screen = () => (
  <FrappThemeProvider>
    <DocumentsScreen />
  </FrappThemeProvider>
);

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(screen(), {
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal"
          ? { present, dismiss: vi.fn() }
          : null,
    });
  });
  mounted.push(tree);
  return tree;
}

const uploadControls = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Upload document",
  );

const sheets = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "BottomSheetModal");

afterEach(() => {
  permissions = [];
  folderRows = [];
  chapterId = "chapter-a";
  present.mockReset();
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("Documents upload (#3399)", () => {
  it.each([
    ["chapter_docs:upload", ["members:view", "chapter_docs:upload"]],
    ["the owner's wildcard", ["*"]],
  ])(
    "draws the glyph on the back row for %s, and it opens s21",
    (_who, held) => {
      permissions = held;
      const tree = render();

      const [upload] = uploadControls(tree);
      expect(upload).toBeDefined();
      const backRow = tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Back to More",
      ).parent!;
      expect(backRow.findAll((node) => node === upload)).toHaveLength(1);
      expect(upload!.findByType(UploadGlyph).props.color).toBe("#7A3FC2");

      act(() => {
        upload!.props.onPress();
      });
      expect(present).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["a member", ["members:view", "backwork:upload"]],
    ["a viewer whose permissions are still loading", []],
  ])("draws no glyph and no sheet for %s", (_who, held) => {
    permissions = held;
    const tree = render();

    expect(uploadControls(tree)).toHaveLength(0);
    expect(sheets(tree)).toHaveLength(0);
  });

  it("says where a filed document went, until the sheet opens again", () => {
    permissions = ["*"];
    const tree = render();
    const sheet = tree.root.find(
      (node) => typeof node.props.onUploaded === "function",
    );

    act(() => {
      sheet.props.onUploaded("Minutes — Nov 2");
    });
    expect(screenText(tree)).toContain("“Minutes — Nov 2” is in the library.");

    act(() => {
      uploadControls(tree)[0]!.props.onPress();
    });
    expect(screenText(tree)).not.toContain("is in the library.");
  });

  it("opens s21 on the folder s12 is filtered to", () => {
    permissions = ["*"];
    folderRows = [
      { id: "f1", name: "Minutes", sort_order: 0 },
      { id: "f2", name: "Bylaws", sort_order: 1 },
    ];
    const tree = render();
    const uploadSheet = () =>
      tree.root.find((node) => typeof node.props.onUploaded === "function");
    expect(uploadSheet().props.initialFolder).toBeNull();

    act(() => {
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Filter by folder" &&
            typeof node.props.onSelect === "function",
        )
        .props.onSelect("Bylaws");
    });
    expect(uploadSheet().props.initialFolder).toBe("Bylaws");
  });

  it("mounts a fresh s21 for each chapter", () => {
    // A retry s21 holds names a path minted under the chapter it was sent from.
    permissions = ["*"];
    const tree = render();
    const uploadSheet = () =>
      tree.root.find((node) => typeof node.props.onUploaded === "function");
    const first = uploadSheet();

    act(() => {
      tree.update(screen());
    });
    expect(uploadSheet()).toBe(first);

    chapterId = "chapter-b";
    act(() => {
      tree.update(screen());
    });
    expect(uploadSheet()).not.toBe(first);
  });

  it("no longer sends anyone to the web dashboard", () => {
    const tree = render();

    expect(screenText(tree)).toContain(
      "Documents the chapter uploads show up here.",
    );
    expect(screenText(tree)).not.toContain("web dashboard");
  });
});
