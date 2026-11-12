/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  Image,
  Platform,
  Text,
} from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * s15's photo block (#732), rendered: what it draws with and without a
 * photo, and that each action reaches its mutation. The avatar is the control
 * (the owner's design review, 2026-11-04), and Remove confirms first.
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
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
  }),
}));
vi.mock("@/lib/more/profile-photo", () => ({
  pickAndSetProfilePhoto: (...args: unknown[]) => state.pick(...args),
}));

import { CameraGlyph } from "@/components/service-hours/camera-glyph";
import { ProfilePhoto } from "./profile-photo";

function photo(photoUrl: string | null, fetchedAt = 1) {
  return (
    <FrappThemeProvider>
      <ProfilePhoto photoUrl={photoUrl} fetchedAt={fetchedAt} initials="PC" />
    </FrappThemeProvider>
  );
}

function render(photoUrl: string | null, fetchedAt = 1): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(photo(photoUrl, fetchedAt));
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => node.props.children);

/** The avatar, which is the control now: there is no text button under it. */
const avatar = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "button",
  );

function tapAvatar(tree: ReactTestRenderer) {
  return act(async () => {
    avatar(tree).props.onPress();
  });
}

type AlertButton = { text: string; style?: string; onPress?: () => void };

/** The buttons of the `n`th native alert raised so far. */
function alertButtons(n = 0): AlertButton[] {
  return vi.mocked(Alert.alert).mock.calls[n]![2] as AlertButton[];
}

/** Picks an option off the iOS action sheet the avatar opened. */
function pickSheetOption(label: string) {
  const [options, choose] = vi.mocked(ActionSheetIOS.showActionSheetWithOptions)
    .mock.calls[0]!;
  return act(async () => {
    choose(options.options.indexOf(label));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.chapterId = "c-1";
  state.remove.mockResolvedValue({});
  state.pick.mockResolvedValue({ status: "updated" });
});

describe("ProfilePhoto", () => {
  it("draws initials, and the avatar adds a photo, when there is none", () => {
    const tree = render(null);

    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(texts(tree)).toEqual(["PC"]);
    expect(avatar(tree).props.accessibilityLabel).toBe("Add profile photo");
    expect(avatar(tree).props.disabled).toBe(false);
  });

  it("draws the photo, and the avatar changes it, when there is one", () => {
    const tree = render("https://signed/photo");

    expect(tree.root.findByType(Image).props.source).toEqual({
      uri: "https://signed/photo",
    });
    expect(avatar(tree).props.accessibilityLabel).toBe("Change profile photo");
    // No text buttons between the avatar and the name any more.
    expect(texts(tree)).toEqual([]);
  });

  it("falls back to initials when the photo fails to load", () => {
    const tree = render("https://signed/expired");

    act(() => {
      tree.root.findByType(Image).props.onError();
    });

    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(texts(tree)).toContain("PC");
  });

  // The API reuses a signed URL for half an hour, so the same URL comes back
  // after a failure; remembering the failure by URL alone hid the photo for
  // that long.
  it("tries the same URL again once the profile is refetched", () => {
    const tree = render("https://signed/same", 1);
    act(() => {
      tree.root.findByType(Image).props.onError();
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(0);

    act(() => {
      tree.update(photo("https://signed/same", 2));
    });

    expect(tree.root.findAllByType(Image)).toHaveLength(1);
  });

  it("tries the same URL again when the device comes back online", () => {
    const tree = render("https://signed/same");
    act(() => {
      onlineManager.setOnline(false);
      tree.root.findByType(Image).props.onError();
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(0);

    act(() => {
      onlineManager.setOnline(true);
    });

    expect(tree.root.findAllByType(Image)).toHaveLength(1);
  });

  it("goes straight to the picker when there is no photo to remove", async () => {
    const tree = render(null);

    await tapAvatar(tree);

    expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(state.pick).toHaveBeenCalledTimes(1);
    // The new photo is the outcome a sighted member sees; a screen reader is
    // told, and nothing is left on the screen.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "Photo updated.",
    );
    expect(texts(tree)).toEqual(["PC"]);
  });

  it("shows a refusal as a sentence", async () => {
    state.pick.mockResolvedValue({
      status: "refused",
      reason: "Profile photos can be up to 25 MB.",
    });
    const tree = render(null);

    await tapAvatar(tree);

    expect(texts(tree)).toContain("Profile photos can be up to 25 MB.");
  });

  it("offers Choose photo and a destructive Remove photo on iOS's action sheet", async () => {
    const tree = render("https://signed/photo");

    await tapAvatar(tree);

    const [options] = vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock
      .calls[0]!;
    expect(options.options).toEqual(["Choose photo", "Remove photo", "Cancel"]);
    expect(options.destructiveButtonIndex).toBe(1);
    expect(options.cancelButtonIndex).toBe(2);

    await pickSheetOption("Choose photo");
    expect(state.pick).toHaveBeenCalledTimes(1);
  });

  it("removes the photo only once the member confirms", async () => {
    const tree = render("https://signed/photo");

    await tapAvatar(tree);
    await pickSheetOption("Remove photo");

    // Choosing Remove asks first, in a native alert, and removes nothing yet.
    expect(state.remove).not.toHaveBeenCalled();
    expect(vi.mocked(Alert.alert).mock.calls[0]![0]).toBe(
      "Remove your profile photo?",
    );
    const remove = alertButtons().find((button) => button.text === "Remove")!;
    expect(remove.style).toBe("destructive");
    expect(alertButtons().find((b) => b.style === "cancel")).toBeDefined();

    await act(async () => {
      remove.onPress!();
    });
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "Photo removed.",
    );
  });

  it("offers the same choice in an alert on Android", async () => {
    const platform = Platform as { OS: string };
    platform.OS = "android";
    try {
      const tree = render("https://signed/photo");
      await tapAvatar(tree);

      expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
      const labels = alertButtons().map((button) => button.text);
      expect(labels).toEqual(["Cancel", "Remove photo", "Choose photo"]);

      // Remove photo still confirms before anything is removed.
      act(() => {
        alertButtons().find((button) => button.text === "Remove photo")!
          .onPress!();
      });
      expect(state.remove).not.toHaveBeenCalled();
      expect(vi.mocked(Alert.alert).mock.calls[1]![0]).toBe(
        "Remove your profile photo?",
      );
    } finally {
      platform.OS = "ios";
    }
  });

  it("says when a removal fails", async () => {
    state.remove.mockRejectedValue(new Error("offline"));
    const tree = render("https://signed/photo");

    await tapAvatar(tree);
    await pickSheetOption("Remove photo");
    await act(async () => {
      alertButtons().find((button) => button.text === "Remove")!.onPress!();
    });

    expect(texts(tree)).toContain(
      "Couldn't remove your photo. Try again in a moment.",
    );
  });

  it("marks the avatar as a control with a badge in the chapter's accent", () => {
    const tree = render("https://signed/photo");
    const badge = avatar(tree).find(
      (node) =>
        (node.type as unknown) === "View" &&
        Object.assign({}, ...[node.props.style].flat()).position === "absolute",
    );
    expect(
      Object.assign({}, ...[badge.props.style].flat()).backgroundColor,
    ).toBe("#8E4EC6");
    expect(badge.findAllByType(CameraGlyph)).toHaveLength(1);
  });

  // foundations.md §6 "Where the accent goes" (2026-11-05): a person's avatar
  // is neutral, the viewer's own included: a hairline ring, a raised fill and
  // foreground initials, never the accent's ring, tint or text.
  it("draws the avatar and its initials neutral, never in the chapter accent", () => {
    const tree = render(null);
    const flat = (style: unknown) =>
      Object.assign({}, ...[style].flat()) as Record<string, unknown>;
    const initials = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "PC",
    );
    expect(flat(initials.props.style).color).toBe(
      signetDarkTokens.color.text.foreground,
    );
    const circle = flat(initials.parent!.props.style);
    expect(circle.borderColor).toBe(signetDarkTokens.color.border.hairline);
    expect(circle.backgroundColor).toBe(signetDarkTokens.color.surface.popover);
    for (const colour of ["#CB9FFF", "#251A33"]) {
      expect(JSON.stringify(initials.parent!.props.style)).not.toContain(colour);
      expect(JSON.stringify(initials.props.style)).not.toContain(colour);
    }
  });

  // The camera says a photo can be chosen. Without a chapter the avatar still
  // takes a tap (it offers Remove photo), but Choose isn't there, so neither
  // is the badge.
  it("draws no camera badge without a chapter, though the avatar can still remove", () => {
    state.chapterId = null;
    const tree = render("https://signed/photo");

    expect(avatar(tree).props.disabled).toBe(false);
    expect(avatar(tree).findAllByType(CameraGlyph)).toHaveLength(0);
    expect(
      avatar(tree).findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          Object.assign({}, ...[node.props.style].flat()).position ===
            "absolute",
      ),
    ).toHaveLength(0);
  });

  it("cannot add a photo without a chapter, and says why", () => {
    state.chapterId = null;
    const tree = render(null);

    expect(avatar(tree).props.disabled).toBe(true);
    expect(texts(tree)).toContain(
      "Choose a chapter from You → Switch chapter to add a photo.",
    );
  });

  // DELETE /v1/users/me/avatar carries no ChapterGuard: only adding a photo
  // needs a chapter, so a member without one can still take theirs down.
  it("still removes a photo without a chapter, and says why Choose isn't offered", async () => {
    state.chapterId = null;
    const tree = render("https://signed/photo");

    expect(avatar(tree).props.disabled).toBe(false);
    expect(avatar(tree).props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    expect(avatar(tree).props.accessibilityLabel).toBe("Remove profile photo");
    expect(texts(tree)).toContain(
      "Choose a chapter from You → Switch chapter to add a photo.",
    );

    await tapAvatar(tree);
    const [options] = vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock
      .calls[0]!;
    expect(options.options).toEqual(["Remove photo", "Cancel"]);
    expect(options.destructiveButtonIndex).toBe(0);
    expect(options.cancelButtonIndex).toBe(1);
    expect(options.message).toBe(
      "Choose a chapter from You → Switch chapter to add a photo.",
    );

    await pickSheetOption("Remove photo");
    await act(async () => {
      alertButtons().find((button) => button.text === "Remove")!.onPress!();
    });
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(state.pick).not.toHaveBeenCalled();
  });

  it("offers Remove alone, with the reason, in Android's alert without a chapter", async () => {
    state.chapterId = null;
    const platform = Platform as { OS: string };
    platform.OS = "android";
    try {
      const tree = render("https://signed/photo");
      await tapAvatar(tree);

      const [, message] = vi.mocked(Alert.alert).mock.calls[0]!;
      expect(message).toBe(
        "Choose a chapter from You → Switch chapter to add a photo.",
      );
      expect(alertButtons().map((button) => button.text)).toEqual([
        "Cancel",
        "Remove photo",
      ]);
    } finally {
      platform.OS = "ios";
    }
  });

  // While an upload or a removal runs, the avatar takes no second tap: one
  // would start a second pick, or a removal racing an upload still confirming.
  it("takes no second tap while an upload runs", async () => {
    let finish!: (value: unknown) => void;
    state.pick.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const tree = render(null);

    await tapAvatar(tree);
    expect(state.pick).toHaveBeenCalledTimes(1);
    expect(avatar(tree).props.disabled).toBe(true);
    expect(avatar(tree).props.accessibilityState).toEqual({
      disabled: false,
      busy: true,
    });

    await tapAvatar(tree);
    expect(state.pick).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ status: "updated" });
    });
    expect(avatar(tree).props.disabled).toBe(false);
  });

  it("takes no second tap while a removal runs", async () => {
    let finish!: (value: unknown) => void;
    state.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const tree = render("https://signed/photo");

    await tapAvatar(tree);
    await pickSheetOption("Remove photo");
    await act(async () => {
      alertButtons().find((button) => button.text === "Remove")!.onPress!();
    });
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(avatar(tree).props.disabled).toBe(true);

    await tapAvatar(tree);
    expect(ActionSheetIOS.showActionSheetWithOptions).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({});
    });
    expect(avatar(tree).props.disabled).toBe(false);
  });
});
