/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Finish your profile (#5627), `app/(app)/finish-profile.tsx`, tested here
 * because a spec under `app/` ships as a route module.
 */
const mocks = vi.hoisted(() => ({
  roles: [] as { id: string; name: string }[],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentUser: () => ({
    data: { id: "u-1", display_name: "Jordan Avery", avatar_url: null },
    dataUpdatedAt: 1,
  }),
  usePickableRoles: () => ({ roles: mocks.roles, isLoading: false }),
  // The back row reads the chapter's accent.
  useCurrentChapter: () => ({ data: undefined }),
}));
vi.mock("@/components/profile/profile-photo", () => ({
  ProfilePhoto: () => null,
}));
vi.mock("@/components/roles/pick-roles-list", () => ({
  PickRolesList: () => null,
}));
vi.mock("@/components/settings/chat-density-sheet", () => ({
  ChatDensityOptions: () => null,
}));

import FinishProfileScreen from "@/app/(app)/finish-profile";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <FinishProfileScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("Finish your profile (phone)", () => {
  it("is a screen with the photo and chat display, and no roles section when none are offered", () => {
    mocks.roles = [];
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Finish your profile");
    expect(text).toContain(
      "Your photo, the roles you're in and how chat looks to you.",
    );
    expect(text).toContain("Photo");
    expect(text).toContain("Chat display");
    expect(text).not.toContain("Your roles");
    tree.unmount();
  });

  it("offers the roles the chapter lets a member join", () => {
    mocks.roles = [{ id: "r1", name: "Social committee" }];
    const tree = render();
    expect(screenText(tree)).toContain("Your roles");
    tree.unmount();
  });
});
