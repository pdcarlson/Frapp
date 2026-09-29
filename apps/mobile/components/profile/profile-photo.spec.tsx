/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Image, Text } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * s15's photo block (#732), rendered: what it draws with and without a
 * photo, and that each action reaches its mutation.
 */

const state = vi.hoisted(() => ({
  chapterId: "c-1" as string | null,
  remove: vi.fn(),
  pick: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => state.chapterId,
  useRequestAvatarUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmAvatar: () => ({ mutateAsync: vi.fn() }),
  useRemoveAvatar: () => ({ mutateAsync: state.remove }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));
vi.mock("@/lib/more/profile-photo", () => ({
  pickAndSetProfilePhoto: (...args: unknown[]) => state.pick(...args),
}));

import { ProfilePhoto } from "./profile-photo";

function render(photoUrl: string | null): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ProfilePhoto photoUrl={photoUrl} initials="PC" />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => node.props.children);

function press(tree: ReactTestRenderer, label: string) {
  const button = tree.root.find(
    (node) =>
      node.props.accessibilityRole === "button" &&
      typeof node.props.onPress === "function" &&
      node.findAllByType(Text).some((t) => t.props.children === label),
  );
  return act(async () => {
    button.props.onPress();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.chapterId = "c-1";
  state.remove.mockResolvedValue({});
  state.pick.mockResolvedValue({ status: "updated" });
});

describe("ProfilePhoto", () => {
  it("draws initials and offers Add photo when there is none", () => {
    const tree = render(null);

    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(texts(tree)).toEqual(expect.arrayContaining(["PC", "Add photo"]));
    expect(texts(tree)).not.toContain("Remove");
  });

  it("draws the photo and offers Change and Remove when there is one", () => {
    const tree = render("https://signed/photo");

    expect(tree.root.findByType(Image).props.source).toEqual({
      uri: "https://signed/photo",
    });
    expect(texts(tree)).toEqual(
      expect.arrayContaining(["Change photo", "Remove"]),
    );
  });

  it("falls back to initials when the photo fails to load", () => {
    const tree = render("https://signed/expired");

    act(() => {
      tree.root.findByType(Image).props.onError();
    });

    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(texts(tree)).toContain("PC");
  });

  it("runs the picker and says the outcome", async () => {
    const tree = render(null);

    await press(tree, "Add photo");

    expect(state.pick).toHaveBeenCalledTimes(1);
    expect(texts(tree)).toContain("Photo updated.");
  });

  it("shows a refusal as a sentence", async () => {
    state.pick.mockResolvedValue({
      status: "refused",
      reason: "Profile photos can be up to 25 MB.",
    });
    const tree = render(null);

    await press(tree, "Add photo");

    expect(texts(tree)).toContain("Profile photos can be up to 25 MB.");
  });

  it("removes the photo", async () => {
    const tree = render("https://signed/photo");

    await press(tree, "Remove");

    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(texts(tree)).toContain("Photo removed.");
  });

  it("cannot add a photo without a chapter, and says why", () => {
    state.chapterId = null;
    const tree = render(null);

    const add = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "button" &&
        node.props.disabled !== undefined,
    );
    expect(add.props.disabled).toBe(true);
    expect(texts(tree)).toContain(
      "Choose a chapter from More → Chapter to add a photo.",
    );
  });
});
