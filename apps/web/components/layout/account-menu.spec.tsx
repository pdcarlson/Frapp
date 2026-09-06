import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// next/link needs a router context jsdom lacks; render a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => <a {...props}>{children}</a>,
}));

const useCurrentUser = vi.fn();
vi.mock("@repo/hooks", () => ({ useCurrentUser: () => useCurrentUser() }));

const signOutCurrentSession = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth/session", () => ({
  signOutCurrentSession: () => signOutCurrentSession(),
}));

const { AccountMenu } = await import("./account-menu");

describe("AccountMenu", () => {
  beforeEach(() => {
    useCurrentUser.mockReturnValue({
      data: {
        display_name: "Paul Carlson",
        email: "paul@example.com",
        avatar_url: null,
      },
    });
  });

  it("carries the affordances it replaced", async () => {
    // Profile left the nav and the header's Sign out button was deleted in the
    // same change. If either one failed to land here it would simply be gone
    // from the dashboard — this is the only place a member can reach them now.
    const user = userEvent.setup();
    render(<AccountMenu variant="sidebar" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.getByRole("menuitem", { name: /profile/i })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(
      screen.getByRole("menuitem", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("names the signed-in member on the trigger", async () => {
    render(<AccountMenu variant="sidebar" />);
    expect(
      screen.getByRole("button", { name: /account menu for Paul Carlson/i }),
    ).toBeInTheDocument();
  });

  it("falls back to a neutral label before the user query resolves", () => {
    useCurrentUser.mockReturnValue({ data: undefined });
    render(<AccountMenu variant="sidebar" />);
    expect(
      screen.getByRole("button", { name: /account menu for Your account/i }),
    ).toBeInTheDocument();
  });

  it("closes the mobile drawer behind a Profile tap", async () => {
    // The dropdown is a modal layer above the Sheet, so dismissing it is not an
    // outside-interaction on the sheet — without this the drawer and its
    // overlay stay up covering the page the member just navigated to. Every
    // nav row already gets the same callback via `renderSections`.
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<AccountMenu variant="sheet" onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /profile/i }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("renders no theme section — Signet is dark-only", async () => {
    // The theme radio group was deleted with next-themes in the #920 shell
    // slice. If it ever reappears, this menu is the place it would land.
    const user = userEvent.setup();
    render(<AccountMenu variant="sidebar" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.queryByText(/theme/i)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });
});
