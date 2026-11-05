/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";

/**
 * The chapter picker, opened from More (`app/(tabs)/more.tsx`). It draws
 * `‹ More` like every screen opened from a More row (navigation.md § Back
 * rows), but only when More's row says it opened it: a link has sign-in
 * anchored under it, so "something to go back to" doesn't mean More. The row
 * goes back rather than opening More again, and holds while a switch runs. The
 * chapter that's open now is marked, and a tap on it selects it again like any
 * row, since the mark reads a token claim that can lag the server; unlike any
 * other row, it leaves even when that fails.
 *
 * Here, not beside the screen: a spec under `app/` is a route module and
 * ships in the bundle (`lib/routes.spec.ts`).
 */

const selectChapter = vi.fn();

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

function moreRow(root: Node): Node | undefined {
  return root
    .findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Back to More",
    )
    .at(0);
}

/** A switch that waits for the spec to settle it. */
function pendingSwitch(): (ok: boolean) => Promise<void> {
  let settle!: (ok: boolean) => void;
  selectChapter.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      settle = resolve;
    }),
  );
  return async (ok) => {
    await act(async () => {
      settle(ok);
    });
  };
}

function rowFor(root: Node, name: string): Node {
  return root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      drawnText(node).startsWith(name),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  selectChapter.mockResolvedValue(true);
  // Something is under the picker either way: the More tab, or sign-in,
  // which `(auth)/_layout.tsx` anchors under a screen a link opens.
  vi.mocked(router.canGoBack).mockReturnValue(true);
  // As More's Switch chapter row opens it.
  vi.mocked(useLocalSearchParams).mockReturnValue({ from: "more" });
});

describe("chapter picker, opened from More", () => {
  it("draws ‹ More, which goes back to the tabs underneath", () => {
    const tree = render();
    const back = moreRow(tree.root)!;
    const column = tree.root.findByType("ScrollView" as never);

    expect(drawnText(back)).toBe("‹ More");
    // At the top of the column, where every screen opened from More puts its
    // row and title, rather than floating above a centred list.
    expect(
      Object.assign({}, ...column.props.contentContainerStyle).justifyContent,
    ).toBe("flex-start");
    act(() => {
      back.props.onPress();
    });
    // Back, not navigate: (tabs) is already under it.
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("draws no row, and keeps the centred column, when a link opened it", () => {
    // A link carries no `from`, and has sign-in under it: `canGoBack` is
    // still true (beforeEach), so it can't be what decides.
    vi.mocked(useLocalSearchParams).mockReturnValue({});
    const tree = render();
    const column = tree.root.findByType("ScrollView" as never);

    expect(moreRow(tree.root)).toBeUndefined();
    expect(
      Object.assign({}, ...column.props.contentContainerStyle).justifyContent,
    ).toBe("center");
  });

  it("holds ‹ More while a switch is in flight", async () => {
    const settle = pendingSwitch();
    const tree = render();
    expect(moreRow(tree.root)?.props.disabled).toBe(false);

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(moreRow(tree.root)?.props.disabled).toBe(true);

    await settle(false);
    expect(moreRow(tree.root)?.props.disabled).toBe(false);
  });

  it("doesn't navigate when a switch lands after the picker went away", async () => {
    const settle = pendingSwitch();
    const tree = render();
    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });

    // Backed out with Android back or the edge swipe while it ran.
    act(() => {
      tree.unmount();
    });
    await settle(true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("doesn't navigate when a switch lands while another screen covers it", async () => {
    const settle = pendingSwitch();
    const tree = render();
    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });

    const focus = expoRouter as unknown as {
      __blur: () => void;
      __refocus: () => void;
    };
    act(() => focus.__blur());
    await settle(true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    act(() => focus.__refocus());
    tree.unmount();
  });

  it("has no line narrating the list under its title", () => {
    const tree = render();

    expect(drawnText(tree.root)).not.toContain("Pick the chapter");
  });

  it("marks the chapter that's open, and selects it again when it's tapped", async () => {
    const tree = render();
    const current = rowFor(tree.root, "FIJI Tau Nu");
    const other = rowFor(tree.root, "Sigma Phi Epsilon");

    expect(drawnText(current)).toContain("Current");
    expect(drawnText(other)).not.toContain("Current");

    // The mark reads the token's claim, which can lag the server's active
    // chapter, so the tap re-asserts it as any row's tap would.
    await act(async () => {
      current.props.onPress();
    });
    expect(selectChapter).toHaveBeenCalledWith("chapter-tau-nu");
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("leaves from the Current row even when selecting it again fails", async () => {
    // Offline, say. The token in hand is on that chapter already, so the
    // tabs work as before; an error here would strand the member on it.
    selectChapter.mockResolvedValueOnce(false);
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "FIJI Tau Nu").props.onPress();
    });
    expect(selectChapter).toHaveBeenCalledWith("chapter-tau-nu");
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(drawnText(tree.root)).not.toContain("Could not switch chapters");
  });

  it("stays, with the error, when a switch to another chapter fails", async () => {
    selectChapter.mockResolvedValueOnce(false);
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(selectChapter).toHaveBeenCalledWith("chapter-eta");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(drawnText(tree.root)).toContain("Could not switch chapters");
  });

  it("still switches to another chapter, then goes back", async () => {
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(selectChapter).toHaveBeenCalledWith("chapter-eta");
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
