/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";

/**
 * The chapter picker, opened from More (`app/(tabs)/more.tsx`). It draws
 * `‹ More` like every screen opened from a More row (navigation.md § Back
 * rows), going back rather than opening More again, and marks the chapter
 * that's open now, which a tap just leaves rather than re-selecting.
 *
 * Here, not beside the screen: a spec under `app/` is a route module and
 * ships in the bundle (`lib/routes.spec.ts`).
 */

const selectChapter = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    chapterId: "chapter-tau-nu",
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => selectChapter,
}));

vi.mock("@repo/hooks", () => ({
  useListChapters: () => ({
    data: [
      {
        chapter_id: "chapter-tau-nu",
        chapter: { name: "FIJI Tau Nu", university: "Rensselaer" },
      },
      {
        chapter_id: "chapter-eta",
        chapter: { name: "Sigma Phi Epsilon", university: "UCLA" },
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import ChapterPicker from "@/app/(auth)/chapter-picker";

type Node = ReactTestRenderer["root"];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChapterPicker />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const router = vi.mocked(useRouter)();

function rowFor(root: Node, name: string): Node {
  return root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      drawnText(node).startsWith(name),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(router.canGoBack).mockReturnValue(true);
});

describe("chapter picker, opened from More", () => {
  it("draws ‹ More, which goes back to the tabs underneath", () => {
    const tree = render();
    const back = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Back to More",
    );

    expect(drawnText(back)).toBe("‹ More");
    act(() => {
      back.props.onPress();
    });
    // Back, not navigate: (tabs) is already under it.
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("draws no row when a link opened it with nothing behind", () => {
    vi.mocked(router.canGoBack).mockReturnValue(false);
    const tree = render();

    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Back to More",
      ),
    ).toHaveLength(0);
  });

  it("has no line narrating the list under its title", () => {
    const tree = render();

    expect(drawnText(tree.root)).not.toContain("Pick the chapter");
  });

  it("marks the chapter that's open, and only leaves when it's tapped", () => {
    const tree = render();
    const current = rowFor(tree.root, "FIJI Tau Nu");
    const other = rowFor(tree.root, "Sigma Phi Epsilon");

    expect(drawnText(current)).toContain("Current");
    expect(drawnText(other)).not.toContain("Current");

    act(() => {
      current.props.onPress();
    });
    expect(selectChapter).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("still switches to another chapter", async () => {
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(selectChapter).toHaveBeenCalledWith("chapter-eta");
  });
});
