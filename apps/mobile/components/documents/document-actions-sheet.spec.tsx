/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#7A3FC2" }),
}));

import {
  DocumentActionsSheet,
  type DocumentActionsTarget,
} from "./document-actions-sheet";

/**
 * s12's long-press sheet (#3934): Star for everyone; Pin for the chapter and
 * a file's Delete for `chapter_docs:manage` only; an action menu's chrome,
 * with no title, no Cancel and no explaining lines; and a row that runs once
 * the sheet has closed.
 */
const FILE: DocumentActionsTarget = {
  kind: "document",
  id: "d-1",
  name: "Chapter bylaws",
  pinned: false,
  starred: false,
};
const FOLDER: DocumentActionsTarget = {
  kind: "folder",
  id: "f-1",
  name: "Rush",
  pinned: true,
  starred: true,
};

const dismiss = vi.fn();

function render(target: DocumentActionsTarget, canManage: boolean) {
  const onToggleStar = vi.fn();
  const onTogglePin = vi.fn();
  const onDelete = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <DocumentActionsSheet
          ref={React.createRef<never>()}
          target={target}
          canManage={canManage}
          onToggleStar={onToggleStar}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { dismiss, present: vi.fn() }
            : null,
      },
    );
  });
  return { tree, onToggleStar, onTogglePin, onDelete };
}

const rowLabels = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        node.type === ("Pressable" as never) &&
        node.props.accessibilityRole === "button",
    )
    .map((node) => node.props.accessibilityLabel as string);

const row = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === label,
  );

const finishClosing = (tree: ReactTestRenderer) =>
  act(() =>
    tree.root
      .find((node) => node.type === ("BottomSheetModal" as never))
      .props.onDismiss(),
  );

describe("DocumentActionsSheet (#3934)", () => {
  it("offers a member Star alone", () => {
    const { tree } = render(FILE, false);
    expect(rowLabels(tree)).toEqual(["Star"]);
  });

  it("offers whoever manages documents Pin, and Delete on a file", () => {
    expect(rowLabels(render(FILE, true).tree)).toEqual([
      "Star",
      "Pin for the chapter",
      "Delete document",
    ]);
    // A folder is deleted on web, from its Edit controls.
    expect(rowLabels(render(FOLDER, true).tree)).toEqual([
      "Unstar",
      "Unpin for the chapter",
    ]);
  });

  it("heads the menu with the item's name, and draws no Cancel and no explainers", () => {
    const { tree } = render(FILE, true);
    const text = screenText(tree);
    expect(text).toContain("Chapter bylaws");
    expect(text).not.toContain("Cancel");
    expect(text).not.toContain("Only you see");
    expect(text).not.toContain("Everyone sees");
  });

  it("runs a row only once the sheet has closed, and only once", () => {
    dismiss.mockClear();
    const { tree, onToggleStar, onTogglePin, onDelete } = render(FILE, true);

    act(() => row(tree, "Star").props.onPress());
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onToggleStar).not.toHaveBeenCalled();
    finishClosing(tree);
    expect(onToggleStar).toHaveBeenCalledWith(FILE);
    finishClosing(tree);
    expect(onToggleStar).toHaveBeenCalledTimes(1);

    act(() => row(tree, "Pin for the chapter").props.onPress());
    finishClosing(tree);
    expect(onTogglePin).toHaveBeenCalledWith(FILE);

    act(() => row(tree, "Delete document").props.onPress());
    finishClosing(tree);
    expect(onDelete).toHaveBeenCalledWith(FILE);
  });
});
