/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { readRolePickerPayload } from "@repo/chat-core/role-pickers";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The role picker card (#4958): one Join or Leave button per listed role,
 * from this viewer's roles, and the Add roles sheet's write on a tap.
 */

const state = vi.hoisted(() => ({
  pickable: [] as {
    id: string;
    name: string;
    held: boolean;
    joinable: boolean;
  }[],
  chapterRoles: [] as { id: string; name: string }[],
  loading: false,
  heldKnown: true as boolean | undefined,
  mutateAsync: vi.fn(),
  writeBlockedReason: null as string | null,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePickableRoles: () => ({
    roles: state.pickable,
    heldKnown: state.heldKnown ?? true,
    isLoading: state.loading,
    isError: false,
    refetch: vi.fn(),
  }),
  useRoles: () => ({ data: state.chapterRoles }),
  useSetPickedRole: () => ({
    mutateAsync: state.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: state.writeBlockedReason }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#292109",
  }),
}));

import { RolePickerCard } from "./role-picker-card";

const role = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  permissions: [],
  is_system: false,
  system_key: null,
  self_assignable: true,
  ...extra,
});

function message(roleIds: string[]): ChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "officer",
    content: "Pick your roles",
    kind: "role_picker",
    _status: "confirmed",
    reactions: [],
    sender_blocked: false,
    _blockEvaluated: true,
    payload: { title: "Pick your roles", role_ids: roleIds },
  } as unknown as ChatMessage;
}

function render(msg: ChatMessage): ReactTestRenderer {
  const payload = readRolePickerPayload(msg)!;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <RolePickerCard
          message={msg}
          payload={payload}
          viewerId="me"
          isConfirmed
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  );

const hasButton = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  ).length > 0;

beforeEach(() => {
  state.heldKnown = true;
  state.pickable = [
    { id: "im", name: "Intramurals", held: false, joinable: true },
    { id: "study", name: "Study group", held: true, joinable: true },
  ];
  state.chapterRoles = [
    role("im", "Intramurals"),
    role("study", "Study group"),
    role("games", "Video games", { self_assignable: false }),
  ];
  state.loading = false;
  state.writeBlockedReason = null;
  state.mutateAsync.mockReset().mockResolvedValue({ role_ids: [] });
});

describe("RolePickerCard (#4958)", () => {
  it("draws Join, Leave, and a closed row with no button", () => {
    const tree = render(message(["im", "study", "games", "deleted"]));
    const text = screenText(tree);
    expect(text).toContain("Role picker");
    expect(text).toContain("Pick your roles");
    expect(button(tree, "Join Intramurals").props.accessibilityState).toEqual({
      disabled: false,
    });
    expect(hasButton(tree, "Leave Study group")).toBe(true);
    expect(text).toContain("Video games");
    expect(text).toContain("No longer open to join");
    expect(hasButton(tree, "Join Video games")).toBe(false);
    // A role deleted since the card was posted is left out.
    expect(text).not.toContain("deleted");
  });

  it("offers no button until the viewer's own roles are read", () => {
    state.heldKnown = false;
    const text = screenText(render(message(["im", "study"])));
    expect(text).not.toContain("Join");
    expect(text).toContain("Loading roles");
  });

  it("joins and leaves through the Add roles write", async () => {
    const tree = render(message(["im", "study"]));
    await act(async () => button(tree, "Join Intramurals").props.onPress());
    expect(state.mutateAsync).toHaveBeenCalledWith({ id: "im", join: true });
    await act(async () => button(tree, "Leave Study group").props.onPress());
    expect(state.mutateAsync).toHaveBeenCalledWith({
      id: "study",
      join: false,
    });
  });

  it("says a refusal under the row that was tapped", async () => {
    state.mutateAsync.mockRejectedValue(new Error("boom"));
    const tree = render(message(["im", "study"]));
    await act(async () => button(tree, "Join Intramurals").props.onPress());
    const text = screenText(tree);
    expect(text).toContain("Intramurals\nJoin\nCouldn't join Intramurals.");
    expect(text).not.toContain("Couldn't leave");
  });

  it("disables the buttons while a write would be lost", () => {
    state.writeBlockedReason = "Reconnect first";
    const tree = render(message(["im"]));
    expect(button(tree, "Join Intramurals").props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it("says when every listed role is gone", () => {
    const tree = render(message(["deleted"]));
    expect(screenText(tree)).toContain("These roles are gone.");
  });
});
