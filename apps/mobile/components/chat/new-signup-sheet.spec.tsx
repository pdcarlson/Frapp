/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SIGNUP_SPOTS_PROBLEM } from "@repo/chat-core/signups";

/**
 * The phone's New sign-up sheet (#3926), rendered: what it posts, when Post
 * is held, a bad Spots value named on its row, and what a refused queue
 * leaves behind.
 */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import { NewSignupSheet, type NewSignupSheetProps } from "./new-signup-sheet";

function render(onPost: NewSignupSheetProps["onPost"]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewSignupSheet onPost={onPost} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const field = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === "function",
  );

const postButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label !== undefined &&
      /Post/.test(String(node.props.label)) &&
      typeof node.type === "function",
  );

function type(tree: ReactTestRenderer, label: string, text: string) {
  act(() => field(tree, label).props.onChangeText(text));
}

function fill(tree: ReactTestRenderer) {
  type(tree, "Title", "Sober drivers");
  type(tree, "Slot 1 name", "Friday");
  type(tree, "Slot 1 spots", "2");
  type(tree, "Slot 2 name", "Saturday");
}

beforeEach(() => successHaptic.mockReset());

describe("New sign-up sheet (#3926)", () => {
  it("holds Post until there's a title and a named slot", () => {
    const tree = render(vi.fn());
    expect(postButton(tree).props.disabled).toBe(true);
    type(tree, "Title", "Sober drivers");
    expect(postButton(tree).props.disabled).toBe(true);
    type(tree, "Slot 1 name", "Friday");
    expect(postButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("posts the built card, blank Spots as no limit, then clears the draft", async () => {
    const onPost = vi.fn<NewSignupSheetProps["onPost"]>(async () => ({
      ok: true as const,
    }));
    const tree = render(onPost);
    fill(tree);
    await act(async () => postButton(tree).props.onPress());

    expect(onPost).toHaveBeenCalledTimes(1);
    const signup = onPost.mock.calls[0]![0];
    expect(signup.content).toBe("Sober drivers");
    expect(
      signup.payload.slots.map(({ label, capacity }) => ({ label, capacity })),
    ).toEqual([
      { label: "Friday", capacity: 2 },
      { label: "Saturday", capacity: null },
    ]);
    expect(signup.payload.slots.every((slot) => slot.id.length > 0)).toBe(true);
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(field(tree, "Title").props.value).toBe("");
    act(() => tree.unmount());
  });

  it("names a bad Spots value and holds Post", () => {
    const tree = render(vi.fn());
    fill(tree);
    type(tree, "Slot 1 spots", "0");
    expect(screenText(tree)).toContain(SIGNUP_SPOTS_PROBLEM);
    expect(postButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("keeps the draft and says why when nothing was queued", async () => {
    const tree = render(async () => ({
      ok: false as const,
      error: "Couldn't post that sign-up sheet. Try again.",
    }));
    fill(tree);
    await act(async () => postButton(tree).props.onPress());
    expect(screenText(tree)).toContain(
      "Couldn't post that sign-up sheet. Try again.",
    );
    expect(field(tree, "Title").props.value).toBe("Sober drivers");
    expect(successHaptic).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
