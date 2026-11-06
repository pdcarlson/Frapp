/** @vitest-environment jsdom */
import { backArrowColor } from "@/test/back-row";
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Platform } from "react-native";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider, tint } from "@/lib/theme";
import { flatStyle } from "@/test/flat-style";
import { drawnText } from "@/test/screen-text";

/**
 * The chapter picker, opened from More (`app/(tabs)/more.tsx`). It draws
 * `‹ More` like every screen opened from a More row (navigation.md § Back
 * rows), but only when More's row says it opened it: a link has sign-in
 * anchored under it, so "something to go back to" doesn't mean More. The row
 * goes back rather than opening More again, and holds while a switch runs. The
 * chapter that's open now is marked, and a tap on it selects it again like any
 * row, since the mark reads a token claim that can lag the server. Whether a
 * failed select leaves is `handleSelect`'s exit rule (its comment states it);
 * these pin each case of it.
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

// A purple stand-in for the chapter's accent: the picker is opened from
// inside a chapter, so a back row that lost `house` would paint it.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

const TAU_NU = {
  chapter_id: "chapter-tau-nu",
  chapter: { name: "FIJI Tau Nu", university: "Rensselaer" },
};
const ETA = {
  chapter_id: "chapter-eta",
  chapter: { name: "Sigma Phi Epsilon", university: "UCLA" },
};
let chapters = [TAU_NU, ETA];
const refetchChapters = vi.fn();

vi.mock("@repo/hooks", () => ({
  useListChapters: () => ({
    data: chapters,
    isPending: false,
    isError: false,
    refetch: refetchChapters,
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

/** The chapters the picker asked `selectChapter` for, in order. */
const selected = () => selectChapter.mock.calls.map(([id]) => id);

/**
 * A switch whose activate lands and whose refresh then fails: the server holds
 * the chapter while the token in hand, and so `Current`, doesn't.
 */
function halfAppliedSwitch() {
  selectChapter.mockImplementationOnce(
    async (_id: string, options?: { onActivated?: () => void }) => {
      options?.onActivated?.();
      return false;
    },
  );
}

/** A switch the server refuses: the member isn't in that chapter any more. */
function refusedSwitch() {
  selectChapter.mockImplementationOnce(
    async (_id: string, options?: { onRefused?: () => void }) => {
      options?.onRefused?.();
      return false;
    },
  );
}

const REFUSED = "You can't open that chapter because you're no longer a member";

function rowFor(root: Node, name: string): Node {
  return root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      drawnText(node).startsWith(name),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  chapters = [TAU_NU, ETA];
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

    expect(drawnText(back)).toBe("More");
    // House gold (`gold.askText`), not the chapter's accent, as all of
    // `(auth)` is.
    expect(backArrowColor(back)).toBe(signetDarkTokens.color.gold.askText);
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

  // foundations.md §6 "Where the accent goes" (2026-11-05): a spinner is
  // neutral, never house gold or the chapter accent.
  it("spins the row in flight in a neutral, never gold", async () => {
    const settle = pendingSwitch();
    const tree = render();
    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    const spinners = tree.root.findAll(
      (node) => (node.type as unknown) === "ActivityIndicator",
    );
    expect(spinners.length).toBeGreaterThan(0);
    for (const spinner of spinners) {
      expect(spinner.props.color).toBe(signetDarkTokens.color.text.muted);
    }
    await settle(false);
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

  it("presses Sign out as the flow's quiet lines do: a ripple on Android, a 0.6 dim on iOS", () => {
    const signOut = rowFor(render().root, "Sign out");
    // `ListRow`'s neutral ripple, through `OnboardingPressable`'s quiet line.
    expect(signOut.props.android_ripple).toEqual({
      color: tint(signetDarkTokens.color.text.foreground, 0.12),
    });
    expect(flatStyle(signOut.props.style, true).opacity).toBe(0.6);

    const os = vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    try {
      expect(flatStyle(signOut.props.style, true).opacity).toBeUndefined();
    } finally {
      os.mockRestore();
    }
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
    expect(selected()).toEqual(["chapter-tau-nu"]);
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
    expect(selected()).toEqual(["chapter-tau-nu"]);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(drawnText(tree.root)).not.toContain("Could not switch chapters");
  });

  it("keeps the Current row on screen when the server refuses it", async () => {
    // Removed from that chapter while the token still names it: the tabs
    // would refuse every request, so the member is told to pick another.
    refusedSwitch();
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "FIJI Tau Nu").props.onPress();
    });
    expect(selected()).toEqual(["chapter-tau-nu"]);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(drawnText(tree.root)).toContain(REFUSED);
    expect(drawnText(tree.root)).not.toContain("Check your connection");
  });

  // The server dropped the member from that chapter, so the list asks again
  // and the row goes; the refetch lands before the screen draws again here.
  it("drops a refused chapter from the list, and keeps the others", async () => {
    refusedSwitch();
    refetchChapters.mockImplementationOnce(() => {
      chapters = [ETA];
    });
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "FIJI Tau Nu").props.onPress();
    });
    expect(refetchChapters).toHaveBeenCalledTimes(1);
    expect(drawnText(tree.root)).not.toContain("FIJI Tau Nu");
    expect(drawnText(tree.root)).toContain("Sigma Phi Epsilon");
    expect(drawnText(tree.root)).toContain(REFUSED);
  });

  it("offers Join once a refused chapter was the member's only one", async () => {
    chapters = [TAU_NU];
    refusedSwitch();
    refetchChapters.mockImplementationOnce(() => {
      chapters = [];
    });
    // A link opened it: no ‹ More, so before the refetch Sign out was the
    // only way off.
    vi.mocked(useLocalSearchParams).mockReturnValue({});
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "FIJI Tau Nu").props.onPress();
    });
    expect(drawnText(tree.root)).toContain("not a member of any chapter yet");
    // "Pick another chapter" would point at nothing.
    expect(drawnText(tree.root)).not.toContain(REFUSED);
    await act(async () => {
      rowFor(tree.root, "Join or start a chapter").props.onPress();
    });
    expect(router.push).toHaveBeenCalledWith("/join");
  });

  it("doesn't fetch the list again when a switch fails offline", async () => {
    selectChapter.mockResolvedValueOnce(false);
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(refetchChapters).not.toHaveBeenCalled();
    expect(drawnText(tree.root)).toContain("Could not switch chapters");
  });

  it("says another row was refused, rather than blaming the connection", async () => {
    refusedSwitch();
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(router.back).not.toHaveBeenCalled();
    expect(drawnText(tree.root)).toContain(REFUSED);
    expect(drawnText(tree.root)).not.toContain("Check your connection");
  });

  it("keeps the error on the Current row after a switch here reached the server", async () => {
    const tree = render();
    halfAppliedSwitch();
    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(drawnText(tree.root)).toContain("Could not switch chapters");

    // The way back fails outright. The server is on Sigma Phi Epsilon, so the
    // next token would move the member there: leaving would hide that.
    selectChapter.mockResolvedValueOnce(false);
    await act(async () => {
      rowFor(tree.root, "FIJI Tau Nu").props.onPress();
    });
    expect(selected()).toEqual(["chapter-eta", "chapter-tau-nu"]);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(drawnText(tree.root)).toContain("Could not switch chapters");
  });

  it("leaves from the Current row once the way back reaches the server", async () => {
    const tree = render();
    halfAppliedSwitch();
    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });

    // Its activate lands, so the server is back on the chapter the token
    // names, and only the refresh after it fails.
    halfAppliedSwitch();
    await act(async () => {
      rowFor(tree.root, "FIJI Tau Nu").props.onPress();
    });
    expect(selected()).toEqual(["chapter-eta", "chapter-tau-nu"]);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(drawnText(tree.root)).not.toContain("Could not switch chapters");
  });

  it("leaves from the Current row after a switch whose activate failed", async () => {
    // Nothing reached the server, so it never left FIJI Tau Nu.
    const tree = render();
    selectChapter.mockResolvedValueOnce(false);
    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(drawnText(tree.root)).toContain("Could not switch chapters");

    selectChapter.mockResolvedValueOnce(false);
    await act(async () => {
      rowFor(tree.root, "FIJI Tau Nu").props.onPress();
    });
    expect(selected()).toEqual(["chapter-eta", "chapter-tau-nu"]);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(drawnText(tree.root)).not.toContain("Could not switch chapters");
  });

  it("stays, with the error, when a switch to another chapter fails", async () => {
    selectChapter.mockResolvedValueOnce(false);
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(selected()).toEqual(["chapter-eta"]);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(drawnText(tree.root)).toContain("Could not switch chapters");
  });

  it("still switches to another chapter, then goes back", async () => {
    const tree = render();

    await act(async () => {
      rowFor(tree.root, "Sigma Phi Epsilon").props.onPress();
    });
    expect(selected()).toEqual(["chapter-eta"]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
