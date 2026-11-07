/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Share } from "react-native";
import * as expoRouter from "expo-router";
import { useLocalSearchParams } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";

/**
 * The Invite members screen (owner ask 2026-11-06: no way to invite from the
 * phone). It renders `app/(app)/invite.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

const state = vi.hoisted(() => ({
  permissions: undefined as string[] | undefined,
  permissionsError: false,
  chapterId: "c-1" as string | undefined,
  chapter: { name: "FIJI Tau Nu" } as { name: string } | undefined,
}));
const { __refocus: refocus, __blur: blur } = expoRouter as unknown as {
  __refocus: () => void;
  __blur: () => void;
};
const createInvite = vi.fn();
let invitesOptions: { enabled?: boolean; refetchInterval?: number } | undefined;

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => state.chapterId,
  useCurrentChapter: () => ({ data: state.chapter }),
  useMyPermissions: () => ({
    data: state.permissions ? { permissions: state.permissions } : undefined,
    isError: state.permissionsError,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useCreateInvite: () => ({ isPending: false, mutateAsync: createInvite }),
  useInvites: (options?: { enabled?: boolean; refetchInterval?: number }) => {
    invitesOptions = options;
    return { data: options?.enabled ? [] : undefined };
  },
}));

// Inside a chapter, so the button and the tile take its accent.
vi.mock("@/lib/chapter-branding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/chapter-branding")>();
  return {
    ...actual,
    useChapterBranding: () => ({
      ...actual.useChapterBranding(),
      accent: "#CB9FFF",
      accentPrimary: "#7B3FE4",
      accentOnPrimary: "#FFFFFF",
      accentSubtle: "#2A1F3D",
      accentBorder: "#5B3F8F",
    }),
  };
});

import InviteScreen, { backTargetFor } from "@/app/(app)/invite";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <InviteScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function shareButton(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityHint ===
        "Makes a new link and opens the share sheet.",
  );
}

beforeEach(() => {
  state.permissions = ["members:invite"];
  state.permissionsError = false;
  state.chapterId = "c-1";
  state.chapter = { name: "FIJI Tau Nu" };
  createInvite.mockReset().mockResolvedValue({ token: "tok123" });
  invitesOptions = undefined;
  vi.mocked(Share.share)
    .mockReset()
    .mockResolvedValue({ action: "sharedAction" });
  vi.mocked(useLocalSearchParams).mockReturnValue({});
});

describe("Invite members", () => {
  it("shares a fresh link in a message that names the chapter", async () => {
    const tree = render();
    expect(screenText(tree)).toContain("A new link for each person");
    expect(screenText(tree)).not.toContain("tok123");
    await act(async () => shareButton(tree)[0].props.onPress());
    // No role named: the server grants the chapter's default invite role.
    expect(createInvite).toHaveBeenCalledWith({});
    const [content] = vi.mocked(Share.share).mock.calls[0];
    expect(content.message).toContain("Join FIJI Tau Nu on Frapp");
    expect(content.message).toContain("tok123");
    // The link is listed, and watched for Joined while the screen is up.
    expect(screenText(tree)).toContain("Link 1");
    expect(screenText(tree)).toContain("Not used yet");
    expect(invitesOptions?.enabled).toBe(true);
    tree.unmount();
  });

  it("holds Share until the chapter's name has loaded", () => {
    state.chapter = undefined;
    const tree = render();
    expect(shareButton(tree)[0].props.disabled).toBe(true);
    tree.unmount();
  });

  it("starts the Shared list over on a new visit", async () => {
    const tree = render();
    await act(async () => shareButton(tree)[0].props.onPress());
    expect(screenText(tree)).toContain("Link 1");
    act(() => blur());
    act(() => refocus());
    expect(screenText(tree)).not.toContain("Link 1");
    tree.unmount();
  });

  it("never sends a link kept in one chapter under another's name", async () => {
    // iOS: the sheet is closed without sending, so the link is kept.
    vi.mocked(Share.share).mockResolvedValueOnce({
      action: "dismissedAction",
    });
    const tree = render();
    await act(async () => shareButton(tree)[0].props.onPress());
    expect(createInvite).toHaveBeenCalledTimes(1);

    state.chapterId = "c-2";
    state.chapter = { name: "Sigma Chi Beta" };
    createInvite.mockResolvedValueOnce({ token: "tok-b" });
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <InviteScreen />
        </FrappThemeProvider>,
      ),
    );
    await act(async () => shareButton(tree)[0].props.onPress());
    expect(createInvite).toHaveBeenCalledTimes(2);
    const [content] = vi.mocked(Share.share).mock.calls[1];
    expect(content.message).toContain("Join Sigma Chi Beta on Frapp");
    expect(content.message).toContain("tok-b");
    expect(content.message).not.toContain("tok123");
    tree.unmount();
  });

  it("paints the button in the chapter accent, not house gold", () => {
    const tree = render();
    const style = shareButton(tree)[0].props.style({ pressed: false });
    expect(style).toContainEqual({ backgroundColor: "#7B3FE4" });
    tree.unmount();
  });

  it("paints the link tile in the chapter accent too", () => {
    const tree = render();
    const tile = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        Array.isArray(node.props.style) &&
        node.props.style.some(
          (style: { backgroundColor?: string } | null) =>
            style?.backgroundColor === "#2A1F3D",
        ),
    );
    expect(tile.props.style).toContainEqual({
      backgroundColor: "#2A1F3D",
      borderColor: "#5B3F8F",
    });
    tree.unmount();
  });

  it("says what went wrong when a link can't be made", async () => {
    createInvite.mockRejectedValueOnce({});
    const tree = render();
    await act(async () => shareButton(tree)[0].props.onPress());
    expect(Share.share).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Couldn't create an invite.");
    tree.unmount();
  });

  it("tells a role that can't invite who can, and draws no button", () => {
    state.permissions = ["members:view"];
    const tree = render();
    expect(screenText(tree)).toContain("Ask an officer for a link");
    expect(shareButton(tree)).toHaveLength(0);
    expect(invitesOptions?.enabled).toBe(false);
    tree.unmount();
  });

  it("waits for the role before deciding, and offers a retry if it fails", () => {
    state.permissions = undefined;
    const loading = render();
    expect(screenText(loading)).not.toContain("Ask an officer");
    expect(shareButton(loading)).toHaveLength(0);
    loading.unmount();

    state.permissionsError = true;
    const failed = render();
    expect(screenText(failed)).toContain("Couldn't load your role");
    failed.unmount();
  });

  it("names the door it was opened from in the back capsule", () => {
    const fromMore = render();
    expectBackRow(fromMore, "More", "/more");
    fromMore.unmount();

    vi.mocked(useLocalSearchParams).mockReturnValue({ from: "directory" });
    const fromDirectory = render();
    expectBackRow(fromDirectory, "Directory", "/directory");
    fromDirectory.unmount();

    expect(backTargetFor("chat").href).toBe("/");
    expect(backTargetFor("anything")).toEqual(backTargetFor(undefined));
  });
});
