/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { ActionSheetIOS, Alert, Platform, Share } from "react-native";
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
const emailInvites = vi.fn();
const revokeInvite = vi.fn();
const refetchInvites = vi.fn();
let invitesOptions:
  { enabled?: boolean; refetchInterval?: number | false } | undefined;
let inviteRows: Record<string, unknown>[] = [];
let invitesFailed = false;

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
  useEmailInvites: () => ({ isPending: false, mutateAsync: emailInvites }),
  useRevokeInvite: () => ({ isPending: false, mutateAsync: revokeInvite }),
  useInvites: (options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  }) => {
    // The share hook's own read is off on this screen, so the screen's read
    // (the one that is on) is the one recorded.
    if (options?.enabled || !invitesOptions) {
      invitesOptions = options;
    }
    return {
      data: options?.enabled && !invitesFailed ? inviteRows : undefined,
      isError: !!options?.enabled && invitesFailed,
      isFetching: false,
      refetch: refetchInvites,
    };
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
import { inviteActions } from "@/components/more/invited-list";

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

function pressables(tree: ReactTestRenderer, hint: string) {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityHint === hint,
  );
}

function emailField(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "TextInput" &&
      node.props.accessibilityLabel === "Email addresses to invite",
  );
}

function sendButton(tree: ReactTestRenderer) {
  return pressables(tree, "Emails each address a link to join.")[0];
}

const ROW = {
  token: "tok-row",
  role: "Member",
  expires_at: "2099-01-01T00:00:00Z",
  used_at: null,
  revoked_at: null,
  created_at: new Date().toISOString(),
};

function rowFor(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );
}

function rerender(tree: ReactTestRenderer) {
  act(() =>
    tree.update(
      <FrappThemeProvider>
        <InviteScreen />
      </FrappThemeProvider>,
    ),
  );
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
  emailInvites.mockReset().mockResolvedValue({ invites: [], failed: [] });
  revokeInvite.mockReset().mockResolvedValue({});
  refetchInvites.mockReset().mockResolvedValue({});
  invitesOptions = undefined;
  inviteRows = [];
  invitesFailed = false;
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
    const [content, options] = vi.mocked(Share.share).mock.calls[0];
    expect(content.message).toContain("Join FIJI Tau Nu on Frapp");
    expect(content.message).toContain("tok123");
    // A mail target gets a subject line (iOS).
    expect(options).toEqual({ subject: "Join FIJI Tau Nu on Frapp" });
    // The Invited list is watched while the screen is up (the mint's own
    // invalidation re-reads it).
    expect(invitesOptions?.enabled).toBe(true);
    expect(invitesOptions?.refetchInterval).toBeGreaterThan(0);
    tree.unmount();
  });

  it("emails an invite through web's route, with no role named", async () => {
    const tree = render();
    act(() => emailField(tree).props.onChangeText(" Pledge@School.edu "));
    await act(async () => sendButton(tree).props.onPress());
    expect(emailInvites).toHaveBeenCalledWith({
      emails: ["Pledge@School.edu"],
    });
    expect(screenText(tree)).toContain("Invite sent to Pledge@School.edu");
    expect(emailField(tree).props.value).toBe("");
    tree.unmount();
  });

  it("sends several addresses at once, and counts them on the button", async () => {
    const tree = render();
    act(() => emailField(tree).props.onChangeText("a@x.edu, b@x.edu; a@x.edu"));
    expect(screenText(tree)).toContain("Send 2 invites");
    await act(async () => sendButton(tree).props.onPress());
    expect(emailInvites).toHaveBeenCalledWith({
      emails: ["a@x.edu", "b@x.edu"],
    });
    expect(screenText(tree)).toContain("2 invites sent");
    tree.unmount();
  });

  it("holds the whole send while an address isn't one", async () => {
    const tree = render();
    act(() => emailField(tree).props.onChangeText("a@x.edu, not-an-email"));
    await act(async () => sendButton(tree).props.onPress());
    expect(emailInvites).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(
      "not-an-email isn't an email address. Fix or remove it.",
    );
    tree.unmount();
  });

  it("keeps an address the server couldn't email, so Send tries it again", async () => {
    emailInvites.mockResolvedValueOnce({ invites: [], failed: ["b@x.edu"] });
    const tree = render();
    act(() => emailField(tree).props.onChangeText("a@x.edu b@x.edu"));
    await act(async () => sendButton(tree).props.onPress());
    expect(emailField(tree).props.value).toBe("b@x.edu");
    expect(screenText(tree)).toContain("Couldn't email this address.");
    // And says what did go out, so no one sends a@x.edu again.
    expect(screenText(tree)).toContain("Invite sent to a@x.edu");
    tree.unmount();
  });

  it("sends once when Send is pressed twice before the first answers", async () => {
    let finish!: (value: unknown) => void;
    emailInvites.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const tree = render();
    act(() => emailField(tree).props.onChangeText("a@x.edu"));
    // The keyboard's Send, then the button, in the same render.
    const viaKeyboard = emailField(tree).props.onSubmitEditing;
    const viaButton = sendButton(tree).props.onPress;
    act(() => {
      viaKeyboard();
      viaButton();
    });
    await act(async () => finish({ invites: [], failed: [] }));
    expect(emailInvites).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it("says what went wrong when the send fails", async () => {
    emailInvites.mockRejectedValueOnce({});
    const tree = render();
    act(() => emailField(tree).props.onChangeText("a@x.edu"));
    await act(async () => sendButton(tree).props.onPress());
    expect(screenText(tree)).toContain("Couldn't send invites.");
    expect(emailField(tree).props.value).toBe("a@x.edu");
    tree.unmount();
  });

  it("holds Send until something is typed", () => {
    const tree = render();
    expect(sendButton(tree).props.disabled).toBe(true);
    tree.unmount();
  });

  it("lists invites under Invited, by address or as a link", () => {
    inviteRows = [
      { ...ROW, id: "i-1", email: "pledge@school.edu", status: "pending" },
      { ...ROW, id: "i-2", email: null, status: "joined" },
      { ...ROW, id: "i-3", email: "gone@school.edu", status: "revoked" },
    ];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Invited");
    expect(text).toContain("pledge@school.edu");
    expect(text).toContain("Pending");
    expect(text).toContain("Invite link");
    expect(text).toContain("Joined");
    // Revoked ones go, as on web.
    expect(text).not.toContain("gone@school.edu");
    expect(text).not.toContain("tok-row");
    tree.unmount();
  });

  it("offers web's row actions, and revokes and resends through them", async () => {
    inviteRows = [
      { ...ROW, id: "i-1", email: "pledge@school.edu", status: "pending" },
    ];
    const sheet = vi
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => undefined);
    const tree = render();
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "pledge@school.edu",
    );

    act(() => row.props.onPress());
    const [options, pick] = sheet.mock.calls[0];
    expect(options.options).toEqual([
      "Share link",
      "Send again",
      "Revoke invite",
      "Cancel",
    ]);
    expect(options.destructiveButtonIndex).toBe(2);

    await act(async () => pick(1));
    expect(emailInvites).toHaveBeenCalledWith({
      role: "Member",
      emails: ["pledge@school.edu"],
    });
    expect(screenText(tree)).toContain(
      "Invite sent again to pledge@school.edu",
    );

    await act(async () => pick(2));
    expect(revokeInvite).toHaveBeenCalledWith("i-1");
    expect(screenText(tree)).toContain("Invite revoked.");

    await act(async () => pick(0));
    const [content] = vi.mocked(Share.share).mock.calls[0];
    expect(content.message).toContain("tok-row");
    sheet.mockRestore();
    tree.unmount();
  });

  it("holds Share until the chapter's name has loaded", () => {
    state.chapter = undefined;
    const tree = render();
    expect(shareButton(tree)[0].props.disabled).toBe(true);
    tree.unmount();
  });

  it("refuses more than one send's worth of addresses before sending", async () => {
    const tree = render();
    const many = Array.from({ length: 51 }, (_, i) => `p${i}@x.edu`).join(",");
    act(() => emailField(tree).props.onChangeText(many));
    await act(async () => sendButton(tree).props.onPress());
    expect(emailInvites).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Up to 50 addresses at a time.");
    tree.unmount();
  });

  it("offers each kind of row web's actions, and none on a joined one", () => {
    expect(inviteActions({ status: "pending", email: null })).toEqual([
      "Share link",
      "Revoke invite",
    ]);
    expect(inviteActions({ status: "expired", email: "a@x.edu" })).toEqual([
      "Send again",
    ]);
    // Share link waits for the chapter's name.
    expect(
      inviteActions({ status: "pending", email: "a@x.edu" }, false),
    ).toEqual(["Send again", "Revoke invite"]);

    inviteRows = [{ ...ROW, id: "i-2", email: null, status: "joined" }];
    const tree = render();
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Invite link",
      ),
    ).toHaveLength(0);
    tree.unmount();
  });

  it("keeps Revoke on Android, whose dialog draws at most three buttons", () => {
    inviteRows = [
      { ...ROW, id: "i-1", email: "pledge@school.edu", status: "pending" },
    ];
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const os = Platform.OS;
    (Platform as { OS: string }).OS = "android";
    try {
      const tree = render();
      act(() => rowFor(tree, "pledge@school.edu").props.onPress());
      const buttons = alert.mock.calls[0][2] as { text: string }[];
      expect(buttons.map((b) => b.text)).toEqual([
        "Share link",
        "Send again",
        "Revoke invite",
      ]);
      expect(alert.mock.calls[0][3]).toEqual({ cancelable: true });
      tree.unmount();
    } finally {
      (Platform as { OS: string }).OS = os;
      alert.mockRestore();
    }
  });

  it("says when Send again couldn't email the address", async () => {
    inviteRows = [
      { ...ROW, id: "i-1", email: "pledge@school.edu", status: "expired" },
    ];
    emailInvites.mockResolvedValueOnce({
      invites: [],
      failed: ["pledge@school.edu"],
    });
    const sheet = vi
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => undefined);
    const tree = render();
    act(() => rowFor(tree, "pledge@school.edu").props.onPress());
    const [options, pick] = sheet.mock.calls[0];
    expect(options.options).toEqual(["Send again", "Cancel"]);
    await act(async () => pick(0));
    expect(screenText(tree)).toContain("Couldn't email pledge@school.edu.");
    expect(screenText(tree)).not.toContain("Invite sent again");
    // The failed send still made an invite, so the refetched list grows;
    // the line saying so stays.
    inviteRows = [
      ...inviteRows,
      { ...ROW, id: "i-new", email: "pledge@school.edu", status: "pending" },
    ];
    rerender(tree);
    expect(screenText(tree)).toContain("Couldn't email pledge@school.edu.");
    sheet.mockRestore();
    tree.unmount();
  });

  it("runs one row action at a time", async () => {
    inviteRows = [
      { ...ROW, id: "i-1", email: "a@school.edu", status: "pending" },
      { ...ROW, id: "i-2", email: "b@school.edu", status: "pending" },
    ];
    let finish!: (value: unknown) => void;
    emailInvites.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const sheet = vi
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => undefined);
    const tree = render();
    act(() => rowFor(tree, "a@school.edu").props.onPress());
    act(() => sheet.mock.calls[0][1](1));
    // Row A is still sending: no other menu opens, so nothing goes twice.
    act(() => rowFor(tree, "b@school.edu").props.onPress());
    expect(sheet).toHaveBeenCalledTimes(1);
    await act(async () => finish({ invites: [], failed: [] }));
    act(() => rowFor(tree, "b@school.edu").props.onPress());
    expect(sheet).toHaveBeenCalledTimes(2);
    expect(emailInvites).toHaveBeenCalledTimes(1);
    sheet.mockRestore();
    tree.unmount();
  });

  it("still confirms a revoke that empties the list", async () => {
    inviteRows = [
      { ...ROW, id: "i-1", email: "pledge@school.edu", status: "pending" },
    ];
    const sheet = vi
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => undefined);
    const tree = render();
    act(() => rowFor(tree, "pledge@school.edu").props.onPress());
    await act(async () => sheet.mock.calls[0][1](2));
    inviteRows = [{ ...inviteRows[0], status: "revoked" }];
    rerender(tree);
    expect(screenText(tree)).toContain("Invite revoked.");
    // An invite sent from above the list retires the old line.
    act(() => emailField(tree).props.onChangeText("next@school.edu"));
    await act(async () => sendButton(tree).props.onPress());
    expect(screenText(tree)).not.toContain("Invite revoked.");
    sheet.mockRestore();
    tree.unmount();
  });

  it("never sends a kept link the list has revoked", async () => {
    // iOS: the sheet is closed without sending, so the link is kept.
    vi.mocked(Share.share).mockResolvedValueOnce({
      action: "dismissedAction",
    });
    const sheet = vi
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => undefined);
    const tree = render();
    await act(async () => shareButton(tree)[0].props.onPress());
    inviteRows = [
      { ...ROW, id: "i-k", token: "tok123", email: null, status: "pending" },
    ];
    rerender(tree);
    act(() => rowFor(tree, "Invite link").props.onPress());
    await act(async () => sheet.mock.calls[0][1](1));
    expect(revokeInvite).toHaveBeenCalledWith("i-k");
    createInvite.mockResolvedValueOnce({ token: "tok-fresh" });
    await act(async () => shareButton(tree)[0].props.onPress());
    expect(createInvite).toHaveBeenCalledTimes(2);
    const [content] = vi.mocked(Share.share).mock.calls[1];
    expect(content.message).toContain("tok-fresh");
    sheet.mockRestore();
    tree.unmount();
  });

  it("never sends a kept link again once its row has shared it", async () => {
    vi.mocked(Share.share).mockResolvedValueOnce({
      action: "dismissedAction",
    });
    const sheet = vi
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => undefined);
    const tree = render();
    await act(async () => shareButton(tree)[0].props.onPress());
    inviteRows = [
      { ...ROW, id: "i-k", token: "tok123", email: null, status: "pending" },
    ];
    rerender(tree);
    act(() => rowFor(tree, "Invite link").props.onPress());
    // Share link, to the first person.
    await act(async () => sheet.mock.calls[0][1](0));
    expect(vi.mocked(Share.share).mock.calls[1][0].message).toContain("tok123");
    createInvite.mockResolvedValueOnce({ token: "tok-fresh" });
    await act(async () => shareButton(tree)[0].props.onPress());
    expect(vi.mocked(Share.share).mock.calls[2][0].message).toContain(
      "tok-fresh",
    );
    sheet.mockRestore();
    tree.unmount();
  });

  it("never sends a kept link revoked from somewhere else", async () => {
    vi.mocked(Share.share).mockResolvedValueOnce({
      action: "dismissedAction",
    });
    const tree = render();
    await act(async () => shareButton(tree)[0].props.onPress());
    // Another officer revokes it on web; the next read shows it so.
    inviteRows = [
      { ...ROW, id: "i-k", token: "tok123", email: null, status: "revoked" },
    ];
    rerender(tree);
    createInvite.mockResolvedValueOnce({ token: "tok-fresh" });
    await act(async () => shareButton(tree)[0].props.onPress());
    expect(createInvite).toHaveBeenCalledTimes(2);
    expect(vi.mocked(Share.share).mock.calls[1][0].message).toContain(
      "tok-fresh",
    );
    tree.unmount();
  });

  it("keeps the rows usable while a row's share sheet never answers", async () => {
    inviteRows = [
      { ...ROW, id: "i-1", email: "a@school.edu", status: "pending" },
    ];
    // iOS: a target cancelled inside the sheet never resolves it.
    vi.mocked(Share.share).mockReturnValueOnce(new Promise(() => undefined));
    const sheet = vi
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation(() => undefined);
    const tree = render();
    act(() => rowFor(tree, "a@school.edu").props.onPress());
    await act(async () => sheet.mock.calls[0][1](0));
    act(() => rowFor(tree, "a@school.edu").props.onPress());
    expect(sheet).toHaveBeenCalledTimes(2);
    sheet.mockRestore();
    tree.unmount();
  });

  it("says when the invites couldn't load, and offers a retry", () => {
    invitesFailed = true;
    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load your invites.");
    act(() => rowFor(tree, "Try again").props.onPress());
    expect(refetchInvites).toHaveBeenCalled();
    tree.unmount();
  });

  it("starts the email field over on a new visit", () => {
    const tree = render();
    act(() => emailField(tree).props.onChangeText("half@typ"));
    act(() => blur());
    act(() => refocus());
    expect(emailField(tree).props.value).toBe("");
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

  it("paints the Send button in the chapter accent, not house gold", () => {
    const tree = render();
    const style = sendButton(tree).props.style({ pressed: false });
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
    expect(screenText(tree)).toContain(
      "Ask an officer to send each person their own link.",
    );
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
    const fromYou = render();
    expectBackRow(fromYou, "You", "/you");
    fromYou.unmount();

    vi.mocked(useLocalSearchParams).mockReturnValue({ from: "directory" });
    const fromDirectory = render();
    expectBackRow(fromDirectory, "Directory", "/directory");
    fromDirectory.unmount();

    expect(backTargetFor("chat").href).toBe("/");
    expect(backTargetFor("anything")).toEqual(backTargetFor(undefined));
  });
});
