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
  useDocumentFolders: () => LOADED,
  useDocumentDownloadUrl: () => ({ mutateAsync: vi.fn() }),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmDocumentUpload: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import DocumentsScreen from "@/app/(tabs)/documents";

const present = vi.fn();
const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <DocumentsScreen />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { present, dismiss: vi.fn() }
            : null,
      },
    );
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

  it("no longer sends anyone to the web dashboard", () => {
    const tree = render();

    expect(screenText(tree)).toContain(
      "Documents the chapter uploads show up here.",
    );
    expect(screenText(tree)).not.toContain("web dashboard");
  });
});
