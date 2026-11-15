import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dmMutateAsync,
  memberState,
  mockCurrentUserId,
  mockRouterPush,
  mockToast,
} = vi.hoisted(() => ({
  dmMutateAsync: vi.fn(),
  memberState: {
    data: undefined as Record<string, unknown> | undefined,
    isPending: true,
  },
  mockCurrentUserId: { current: "viewer" as string | null },
  mockRouterPush: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@repo/hooks", async () => ({
  dmChannelIdOf: (
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks")
  ).dmChannelIdOf,
  useMemberByUserId: () => memberState,
  useRoles: () => ({
    data: [
      { id: "r-pres", name: "President", color: null, rank: 1 },
      { id: "r-rush", name: "Rush Chair", color: null, rank: 2 },
    ],
  }),
  useMemberDisplayNames: () => ({
    avatarTintFor: () => null,
    roleColorFor: () => null,
  }),
  useGetOrCreateDm: () => ({ mutateAsync: dmMutateAsync, isPending: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: mockCurrentUserId.current, isLoading: false }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { anchorFor, MemberPopout } from "./member-popout";

const MEMBER = {
  id: "m1",
  user_id: "u1",
  display_name: "Jane Smith",
  major: "Economics",
  graduation_year: 2027,
  role_ids: ["r-pres", "r-rush"],
};

function renderPopout(
  overrides: Partial<React.ComponentProps<typeof MemberPopout>> = {},
) {
  const opener = document.createElement("button");
  opener.textContent = "Jane Smith";
  document.body.appendChild(opener);
  openers.push(opener);
  const onOpenChange = vi.fn();
  const onViewProfile = vi.fn();
  const utils = render(
    <MemberPopout
      userId="u1"
      anchor={anchorFor(opener)}
      open
      onOpenChange={onOpenChange}
      identity={{ name: "Jane (roster)", avatarUrl: null }}
      onViewProfile={onViewProfile}
      {...overrides}
    />,
  );
  return { ...utils, opener, onOpenChange, onViewProfile };
}

beforeEach(() => {
  memberState.data = MEMBER;
  memberState.isPending = false;
  mockCurrentUserId.current = "viewer";
  dmMutateAsync.mockReset();
  mockRouterPush.mockReset();
  mockToast.mockReset();
});

const openers: HTMLElement[] = [];
afterEach(() => {
  for (const opener of openers.splice(0)) opener.remove();
});

describe("MemberPopout", () => {
  it("shows who they are at a glance, named for the screen reader", () => {
    renderPopout();
    const card = screen.getByRole("dialog", { name: "Jane Smith's profile" });
    expect(card).toHaveTextContent("Jane Smith");
    expect(card).toHaveTextContent("Economics · '27");
    expect(screen.getByRole("list", { name: "Roles" })).toHaveTextContent(
      "PresidentRush Chair",
    );
  });

  it("draws the roster's name until the profile read lands", () => {
    memberState.data = undefined;
    memberState.isPending = true;
    renderPopout();
    expect(
      screen.getByRole("dialog", { name: "Jane (roster)'s profile" }),
    ).toBeInTheDocument();
  });

  it("opens the DM and goes there from Message", async () => {
    dmMutateAsync.mockResolvedValue({ id: "chan-dm" });
    const { onOpenChange } = renderPopout();
    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    expect(dmMutateAsync).toHaveBeenCalledWith({ member_id: "u1" });
    expect(mockRouterPush.mock.calls[0]?.[0]).toContain("chan-dm");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no Message on the viewer's own profile", () => {
    mockCurrentUserId.current = "u1";
    renderPopout();
    expect(
      screen.queryByRole("button", { name: "Message" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View profile" }),
    ).toBeInTheDocument();
  });

  it("hands View profile to the full sheet with focus on the opener", () => {
    const { opener, onOpenChange, onViewProfile } = renderPopout();
    fireEvent.click(screen.getByRole("button", { name: "View profile" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onViewProfile).toHaveBeenCalledWith("u1");
    // Focus is on the name before the sheet opens, so the sheet's close
    // returns there.
    expect(document.activeElement).toBe(opener);
  });

  it("puts focus back on the name that opened it when it closes", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Jane Smith";
    document.body.appendChild(opener);
    openers.push(opener);
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <MemberPopout
          userId="u1"
          anchor={anchorFor(opener)}
          open={open}
          onOpenChange={setOpen}
          identity={null}
          onViewProfile={() => {}}
        />
      );
    }
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const { onOpenChange } = renderPopout();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
