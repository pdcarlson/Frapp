import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { markWhatsNewSeen, markWhatsNewUnread } from "@/lib/whats-new";

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

const bulkDropNotice = vi.fn((): string | null => null);
vi.mock("@/lib/backwork-bulk/session", () => ({
  bulkDropNotice: () => bulkDropNotice(),
}));

const ownStatus = vi.hoisted(() => ({
  value: null as null | {
    status: "online" | "idle" | "dnd" | "invisible";
    statusEndsAt: number | null;
    line: string | null;
    lineEndsAt: number | null;
  },
}));
const save = vi.fn<(body: Record<string, unknown>) => Promise<boolean>>(
  async () => true,
);
vi.mock("@/lib/realtime/use-own-status", () => ({
  useOwnStatus: () => ownStatus.value,
  useSaveOwnStatus: () => ({ save, isSaving: false }),
}));

const presenceStatus = vi.hoisted(() => ({ value: "online" }));
vi.mock("@/lib/providers/chapter-presence-provider", () => ({
  useChapterPresenceContext: () => ({
    isReady: true,
    statusOf: () => presenceStatus.value,
    lineOf: () => null,
  }),
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "me" }),
}));
const network = vi.hoisted(() => ({ isOffline: false }));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: network.isOffline }),
}));

const { AccountMenu } = await import("./account-menu");

describe("AccountMenu", () => {
  beforeEach(() => {
    ownStatus.value = {
      status: "online",
      statusEndsAt: null,
      line: null,
      lineEndsAt: null,
    };
    presenceStatus.value = "online";
    network.isOffline = false;
    save.mockClear();
    bulkDropNotice.mockReturnValue(null);
    signOutCurrentSession.mockClear();
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
    // The greenfield shell then moved this whole menu onto the top-bar avatar,
    // which is why the desktop variant is `topbar`.
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);

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
    render(<AccountMenu variant="topbar" />);
    expect(
      screen.getByRole("button", { name: /account menu for Paul Carlson/i }),
    ).toBeInTheDocument();
  });

  it("falls back to a neutral label before the user query resolves", () => {
    useCurrentUser.mockReturnValue({ data: undefined });
    render(<AccountMenu variant="topbar" />);
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

  it("links notification settings at the section that actually exists", async () => {
    // Notification preferences are a section of the profile screen, not a route
    // of their own. A `?tab=` link would be a dead affordance the screen would
    // silently ignore (spec/ui/design-system/README.md §5, rule 2), so this
    // must stay an anchor.
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(
      screen.getByRole("menuitem", { name: /notification settings/i }),
    ).toHaveAttribute("href", "/profile#notification-settings");
  });

  it("opens What's new, the same changelog mobile Settings shows", async () => {
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(
      screen.getByRole("menuitem", { name: /what's new/i }),
    ).toHaveAttribute("href", "/whats-new");
  });

  it("marks What's new while an entry is unread, and clears once it is seen", async () => {
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);
    act(() => markWhatsNewUnread(true));

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(
      screen.getByRole("menuitem", { name: "What's new, new" }),
    ).toBeInTheDocument();

    act(() => markWhatsNewSeen());
    expect(
      screen.getByRole("menuitem", { name: "What's new" }),
    ).toBeInTheDocument();
  });

  it("keeps chapter switching out of the account menu", async () => {
    // Identity and chapter are separate menus: switching lives in the nav's
    // chapter header row. Folding it in here is the merge the board warns off.
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.queryByText(/switch chapter/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/join another chapter/i)).not.toBeInTheDocument();
  });

  it("renders the top-bar trigger as the avatar alone", async () => {
    // No name, no email, no chevron in the bar itself — three lines of chrome
    // the board deletes. The name survives as the accessible name.
    render(<AccountMenu variant="topbar" />);

    const trigger = screen.getByRole("button", { name: /account menu/i });
    expect(trigger).toHaveAccessibleName(/Paul Carlson/);
    expect(trigger).not.toHaveTextContent("paul@example.com");
  });

  it("renders no theme section — Signet is dark-only", async () => {
    // The theme radio group was deleted with next-themes in the #920 shell
    // slice. If it ever reappears, this menu is the place it would land.
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.queryByText(/theme/i)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });
  it("asks before signing out drops Bulk upload documents, and stays put on Cancel", async () => {
    bulkDropNotice.mockReturnValue(
      "Bulk upload has 1 document that isn't uploaded yet. Signing out drops it.",
    );
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Signing out drops it.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(signOutCurrentSession).not.toHaveBeenCalled();
  });

  it("signs out once the member agrees to drop them", async () => {
    bulkDropNotice.mockReturnValue(
      "Bulk upload has 1 document that isn't uploaded yet. Signing out drops it.",
    );
    const user = userEvent.setup();
    render(<AccountMenu variant="topbar" />);
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOutCurrentSession).toHaveBeenCalledTimes(1));
  });

  // #3845: Status is the first row, a submenu, as on Discord and Slack.
  describe("status", () => {
    async function openStatus() {
      const user = userEvent.setup();
      render(<AccountMenu variant="topbar" />);
      await user.click(screen.getByRole("button", { name: /account menu/i }));
      const items = screen.getAllByRole("menuitem");
      expect(items[0]).toHaveTextContent("Online");
      // The keyboard path: a pointer leaving a sub-trigger for its submenu
      // runs Radix's grace-area geometry, which jsdom has no layout for.
      items[0]!.focus();
      await user.keyboard("{ArrowRight}");
      return user;
    }

    /** Selects a submenu row the way a keyboard does. */
    async function choose(name: RegExp) {
      const item = await screen.findByRole("menuitem", { name });
      fireEvent.keyDown(item, { key: "Enter" });
    }

    it("names your own status on the trigger, since the dot is decorative", () => {
      presenceStatus.value = "dnd";
      render(<AccountMenu variant="topbar" />);
      expect(
        screen.getByRole("button", {
          name: "Account menu for Paul Carlson, Do Not Disturb",
        }),
      ).toBeInTheDocument();
    });

    it("picks Invisible with no end time", async () => {
      await openStatus();
      await choose(/invisible/i);
      expect(save).toHaveBeenCalledWith({
        status: "invisible",
        status_expires_at: null,
      });
    });

    it("turns on DND for 1 hour with an end time an hour out", async () => {
      const user = await openStatus();
      (await screen.findByRole("menuitem", { name: /do not disturb/i })).focus();
      await user.keyboard("{ArrowRight}");
      const before = Date.now();
      await choose(/for 1 hour/i);
      const body = save.mock.calls[0]![0] as {
        status: string;
        status_expires_at: string;
      };
      expect(body.status).toBe("dnd");
      const ends = Date.parse(body.status_expires_at);
      expect(ends - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
      expect(ends - before).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
    });

    it("turns on DND until I turn it off with no end time", async () => {
      const user = await openStatus();
      (await screen.findByRole("menuitem", { name: /do not disturb/i })).focus();
      await user.keyboard("{ArrowRight}");
      await choose(/until i turn it off/i);
      expect(save).toHaveBeenCalledWith({
        status: "dnd",
        status_expires_at: null,
      });
    });

    it("saves a custom status that clears at the end of today by default", async () => {
      const user = userEvent.setup();
      render(<AccountMenu variant="topbar" />);
      await user.click(screen.getByRole("button", { name: /account menu/i }));
      await user.click(
        screen.getByRole("menuitem", { name: /set a custom status/i }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.type(
        within(dialog).getByRole("textbox", { name: "Status" }),
        "At practice till 6",
      );
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      const body = save.mock.calls[0]![0] as {
        custom_status: string;
        custom_status_expires_at: string;
      };
      expect(body.custom_status).toBe("At practice till 6");
      const end = new Date(body.custom_status_expires_at);
      expect([end.getHours(), end.getMinutes()]).toEqual([0, 0]);
      expect(end.getTime()).toBeGreaterThan(Date.now());
      expect(end.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });

    it("shows the current line and clears it from the dialog", async () => {
      ownStatus.value = { ...ownStatus.value!, line: "Studying" };
      const user = userEvent.setup();
      render(<AccountMenu variant="topbar" />);
      await user.click(screen.getByRole("button", { name: /account menu/i }));
      await user.click(screen.getByRole("menuitem", { name: "Studying" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(
        within(dialog).getByRole("button", { name: "Clear status" }),
      );
      expect(save).toHaveBeenCalledWith({ custom_status: null });
    });

    it("puts DND's default first, so opening the submenu lands on it", async () => {
      const user = await openStatus();
      (await screen.findByRole("menuitem", { name: /do not disturb/i })).focus();
      await user.keyboard("{ArrowRight}");
      await user.keyboard("{Enter}");
      expect(save).toHaveBeenCalledWith({
        status: "dnd",
        status_expires_at: null,
      });
    });

    it("sends no end time for Don't clear", async () => {
      const user = userEvent.setup();
      render(<AccountMenu variant="topbar" />);
      await user.click(screen.getByRole("button", { name: /account menu/i }));
      await user.click(
        screen.getByRole("menuitem", { name: /set a custom status/i }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.type(
        within(dialog).getByRole("textbox", { name: "Status" }),
        "Abroad",
      );
      // The keyboard path: Radix Select picks on pointer-up geometry jsdom
      // lacks. Open on Today (the default), one down is Don't clear.
      fireEvent.keyDown(
        within(dialog).getByRole("combobox", { name: "Clear after" }),
        { key: "ArrowDown" },
      );
      await screen.findByRole("option", { name: "Don't clear" });
      await user.keyboard("{ArrowDown}");
      fireEvent.keyDown(document.activeElement!, { key: " " });
      expect(
        within(dialog).getByRole("combobox", { name: "Clear after" }),
      ).toHaveTextContent("Don't clear");
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(save).toHaveBeenCalledWith({
        custom_status: "Abroad",
        custom_status_expires_at: null,
      });
    });

    it("won't save a line over 80 characters", async () => {
      const user = userEvent.setup();
      render(<AccountMenu variant="topbar" />);
      await user.click(screen.getByRole("button", { name: /account menu/i }));
      await user.click(
        screen.getByRole("menuitem", { name: /set a custom status/i }),
      );
      const dialog = await screen.findByRole("dialog");
      const field = within(dialog).getByRole("textbox", { name: "Status" });
      fireEvent.change(field, { target: { value: "x".repeat(81) } });
      expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
      expect(dialog).toHaveTextContent("Keep it to 80 characters.");
      fireEvent.submit(field.closest("form")!);
      expect(save).not.toHaveBeenCalled();
    });

    it("disables the status rows while offline", async () => {
      network.isOffline = true;
      const user = userEvent.setup();
      render(<AccountMenu variant="topbar" />);
      await user.click(screen.getByRole("button", { name: /account menu/i }));
      expect(screen.getAllByRole("menuitem")[0]).toHaveAttribute(
        "data-disabled",
      );
      expect(
        screen.getByRole("menuitem", { name: /set a custom status/i }),
      ).toHaveAttribute("data-disabled");
    });
  });
});
