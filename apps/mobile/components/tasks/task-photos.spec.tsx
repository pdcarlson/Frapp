/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet } from "react-native";
import { describe, expect, it, vi } from "vitest";
import type { LiveTaskPhoto } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useTaskPhotoUrl: (_taskId: string, photoId: string | null) => ({
    data: photoId ? `https://signed/${photoId}` : undefined,
  }),
}));

import { TaskPhotoPicker, TaskProof, type TaskProofView } from "./task-photos";

const photo = (id: string, kind: LiveTaskPhoto["kind"]): LiveTaskPhoto => ({
  id,
  kind,
  storage_path: `chapters/c/tasks/${id}/p.jpg`,
});

const TASK: TaskProofView = {
  id: "t1",
  photos: [],
  proofLink: null,
  sentBackReason: null,
  completionNote: null,
};

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );

describe("TaskProof (#4635)", () => {
  it("draws nothing for a task with no photos, proof or reason", () => {
    expect(
      render(<TaskProof task={TASK} showProof sentBack={false} />).toJSON(),
    ).toBeNull();
  });

  it("shows reference photos to anyone, and the proof only to its readers", () => {
    const task = {
      ...TASK,
      photos: [photo("r1", "reference"), photo("p1", "proof")],
      proofLink: "https://www.example.com/report",
      completionNote: "Mopped twice",
    };
    const hidden = screenText(
      render(<TaskProof task={task} showProof={false} sentBack={false} />),
    );
    expect(hidden).toContain("Photos");
    expect(hidden).not.toContain("Proof");
    expect(hidden).not.toContain("example.com");
    expect(hidden).not.toContain("Mopped twice");

    const shown = screenText(
      render(<TaskProof task={task} showProof sentBack={false} />),
    );
    expect(shown).toContain("Proof");
    expect(shown).toContain("example.com");
    expect(shown).toContain("Mopped twice");
  });

  it("shows the reason while it Needs changes, not once it's settled with no reply", () => {
    const task = { ...TASK, sentBackReason: "Floor is still sticky" };
    expect(
      screenText(render(<TaskProof task={task} showProof sentBack />)),
    ).toContain("Floor is still sticky");
    expect(
      render(<TaskProof task={task} showProof sentBack={false} />).toJSON(),
    ).toBeNull();
  });

  it("opens a proof link in the browser", async () => {
    const tree = render(
      <TaskProof
        task={{ ...TASK, proofLink: "https://docs.example.com/x" }}
        showProof
        sentBack={false}
      />,
    );
    await act(async () => {
      byLabel(
        tree,
        "Proof link: docs.example.com, opens in the browser",
      ).props.onPress();
    });
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://docs.example.com/x",
    );
  });

  it("opens the full-screen viewer on the photo tapped", () => {
    const tree = render(
      <TaskProof
        task={{
          ...TASK,
          photos: [photo("p1", "proof"), photo("p2", "proof")],
        }}
        showProof
        sentBack={false}
      />,
    );
    const modal = () =>
      tree.root.find((node) => (node.type as unknown) === "Modal");
    expect(modal().props.visible).toBe(false);
    act(() =>
      byLabel(tree, "Proof, photo 2 of 2, opens full size").props.onPress(),
    );
    expect(modal().props.visible).toBe(true);
    expect(screenText(tree)).toContain("Proof · Photo 2 of 2");
    const list = tree.root.find(
      (node) => (node.type as unknown) === "FlatList",
    );
    expect(list.props.pagingEnabled).toBe(true);
    expect(list.props.horizontal).toBe(true);
    expect(list.props.initialScrollIndex).toBe(1);
    // A page is as tall as the pager measures, never `100%` of a horizontal
    // list's content, which drew each photo 0 tall.
    expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1 });
    act(() =>
      list.props.onLayout({ nativeEvent: { layout: { height: 640 } } }),
    );
    const page = (
      tree.root.find((node) => (node.type as unknown) === "FlatList").props
        .renderItem as (info: { item: unknown }) => React.ReactElement<{
        style: unknown;
      }>
    )({ item: photo("p1", "proof") });
    expect(StyleSheet.flatten(page.props.style)).toMatchObject({ height: 640 });
  });
});

describe("TaskPhotoPicker", () => {
  it("offers Add photos while there's room, and says six is the most", () => {
    const onAdd = vi.fn();
    const some = render(
      <TaskPhotoPicker picked={[]} onRemovePicked={() => {}} onAdd={onAdd} />,
    );
    act(() => byLabel(some, "Add photos").props.onPress());
    expect(onAdd).toHaveBeenCalled();

    const kept = Array.from({ length: 6 }, (_, i) =>
      photo(`k${i}`, "reference"),
    );
    const full = render(
      <TaskPhotoPicker
        taskId="t1"
        kept={kept}
        picked={[]}
        onRemovePicked={() => {}}
        onAdd={onAdd}
      />,
    );
    expect(screenText(full)).toContain("6 photos is the most.");
  });

  it("removes a kept photo by its id", () => {
    const onRemoveKept = vi.fn();
    const tree = render(
      <TaskPhotoPicker
        taskId="t1"
        kept={[photo("k1", "reference")]}
        picked={[]}
        onRemoveKept={onRemoveKept}
        onRemovePicked={() => {}}
        onAdd={() => {}}
      />,
    );
    act(() => byLabel(tree, "Remove photo 1").props.onPress());
    expect(onRemoveKept).toHaveBeenCalledWith("k1");
  });
});
