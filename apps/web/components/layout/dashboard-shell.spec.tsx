import { afterEach, describe, it, expect, vi } from "vitest";
import { createPortal } from "react-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";

/*
 * The assembled shell had no unit coverage at all before this lane — the
 * header, breadcrumb, <h1>, sidebar and ⌘K wiring were pinned only indirectly,
 * which made replacing them feel deceptively safe because almost nothing went
 * red. These tests pin the three acceptance criteria #2141 states:
 *
 *   1. every dashboard route sits in the new shell
 *   2. ⌘K is gone from the shell
 *   3. titles are not in the top bar
 *
 * Criterion 3 was reversed on 2026-11-05: the owner asked for the page title
 * back in the top bar (`top-bar.tsx`, `page-title.ts`), so those tests now pin
 * the title there instead.
 */

const {
  mockPathname,
  mockChapter,
  mockPermissions,
  mockUnread,
  mockLevels,
  mockChannels,
  unreadReads,
} = vi.hoisted(() => ({
  mockPathname: { value: "/events" },
  unreadReads: { count: 0 },
  mockUnread: {
    value: [] as {
      channel_id: string;
      unread_count: number;
      mention_count: number;
    }[],
  },
  mockLevels: {
    value: [] as { channel_id: string; level: string }[] | undefined,
  },
  mockChannels: { value: [] as { id: string; type: string }[] },
  // `undefined` is a chapter read still in flight, which every test but the
  // module-gating one wants: nothing is gated until it resolves.
  mockChapter: { value: undefined as unknown },
  mockPermissions: { value: [] as string[] },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    // The real rules for which counts mean "unread" and which get past a mute.
    sidebarUnreadCounts: actual.sidebarUnreadCounts,
    countsAddressMember: actual.countsAddressMember,
    useChannelUnreadCounts: () => {
      unreadReads.count += 1;
      return { data: mockUnread.value, isError: false };
    },
    useChannelNotificationPreferences: () => ({
      data: mockLevels.value,
      isError: false,
    }),
    useMyPermissions: () => ({ data: { permissions: mockPermissions.value } }),
    useHiddenUnsetFeatures: () => new Set(),
    useNotifications: () => ({ data: [] }),
    // What an ordinary member's config read looks like: `GET /chapters/:id/config`
    // needs `chapter-config:view`, so it errors and never yields data.
    useOrgConfig: () => ({ data: undefined, isError: true }),
    useAccessibleChapters: () => ({ data: [], isSuccess: true }),
    useCurrentChapter: () => ({ data: mockChapter.value, isError: false }),
    useCurrentUser: () => ({ data: { display_name: "Paul Carlson" } }),
    useSearch: () => ({ data: undefined, isFetching: false }),
    useChannels: () => ({ data: mockChannels.value }),
    SEARCH_MIN_QUERY_LENGTH: 3,
  };
});

// ONLINE unless a test says otherwise, as the real provider defaults.
const network = vi.hoisted(() => ({
  state: "ONLINE" as "ONLINE" | "DEGRADED" | "OFFLINE",
}));
vi.mock("@/lib/providers/network-provider", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNetwork: () => ({
    state: network.state,
    isOnline: network.state === "ONLINE",
    isDegraded: network.state === "DEGRADED",
    isOffline: network.state === "OFFLINE",
    linkOnline: network.state !== "OFFLINE",
    probeOnce: async () => {},
  }),
}));
vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => vi.fn(),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-chapter-theme", () => ({ useChapterTheme: () => {} }));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: "chap-1" }),
}));
// Onboarding and Terms gates render their own dialogs off their own queries;
// none is part of the shell's chrome contract.
vi.mock("@/components/onboarding/chapter-wizard-gate", () => ({
  ChapterWizardGate: () => null,
}));
vi.mock("@/components/auth/terms-prompt", () => ({
  TermsPromptGate: () => null,
}));
vi.mock("@/components/onboarding/onboarding-tutorial", () => ({
  OnboardingTutorial: () => null,
}));
vi.mock("@/components/layout/dashboard-notification-drawer", () => ({
  DashboardNotificationDrawer: () => null,
}));
// The binding has its own spec (`use-chat-realtime-binding.spec.tsx`); this
// one pins only that the shell mounts it, on every route (#3745).
const realtimeBinding = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/chat/use-chat-realtime-binding", () => ({
  useChatRealtimeBinding: () => {
    realtimeBinding.calls += 1;
  },
}));

import { DashboardShell } from "./dashboard-shell";
import { useNavFace } from "./nav-face";
import {
  CONNECTION_PILL_ATTR,
  DASHBOARD_SHELL_ATTR,
} from "@/components/shared/connection-pill-focus";

afterEach(() => {
  mockPathname.value = "/events";
  mockPermissions.value = [];
  mockUnread.value = [];
  mockLevels.value = [];
  mockChannels.value = [];
  mockChapter.value = undefined;
  unreadReads.count = 0;
});

/** Stands in for the back arrow ChatShell's own pane puts beside "Channels". */
function BackToMenu() {
  const navFace = useNavFace();
  if (!navFace) return <p>no nav face</p>;
  return (
    <button type="button" onClick={navFace.showModules}>
      Chat pane back arrow
    </button>
  );
}

describe("DashboardShell", () => {
  it("hides a switched-off module's row from a member who cannot read chapter config", () => {
    // #1982: the gate used to come from the config read, which errors for
    // every seeded role below President, so the sidebar kept offering members
    // modules their chapter had turned off. It reads the member view now.
    mockPermissions.value = ["members:view", "backwork:upload"];
    mockChapter.value = {
      name: "Alpha Beta Gamma",
      enabled_modules: { backwork: false },
    };
    try {
      render(
        <DashboardShell>
          <p>route content</p>
        </DashboardShell>,
      );
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(
        within(nav).queryByRole("link", { name: "Backwork" }),
      ).not.toBeInTheDocument();
      expect(
        within(nav).getByRole("link", { name: "Documents" }),
      ).toBeInTheDocument();
    } finally {
      mockPermissions.value = [];
      mockChapter.value = undefined;
    }
  });

  it("renders the route inside a main landmark", () => {
    // The floor gate measures `main`'s computed padding, so its presence is a
    // contract, not an implementation detail.
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("route content")).toBeInTheDocument();
  });

  it("titles the open route in the top bar, as its only h1", () => {
    // 2026-11-05: the title moved from each page's toolbar row into the top
    // bar, derived from the route so every path (loading, offline, error) has
    // it. The words are the nav row's label.
    mockPathname.value = "/study";
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const banner = screen.getByRole("banner");
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(within(banner).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Study hours",
    );
    // A top-level route has no parent link: no chapter-name prefix.
    expect(
      within(banner).queryByRole("link", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("gives a page under Settings its parent as a link back", () => {
    mockPathname.value = "/geofences";
    mockPermissions.value = ["geofences:manage"];
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Study zones",
    );
    expect(
      within(banner).getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("offers no Settings crumb to a member the nav hides Settings from", () => {
    // The parent follows the Settings row's own gates: a member holding none of
    // Settings' permissions sees the tool's title, and no door the nav closed.
    mockPathname.value = "/reports";
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Reports",
    );
    expect(
      within(banner).queryByRole("link", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });

  it("leaves the title cell empty on a route it does not know", () => {
    // No invented title: the old shell called every unmapped route
    // "Dashboard", which was the defect #2141 retired.
    mockPathname.value = "/somewhere-new";
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).not.toHaveTextContent("Dashboard");
  });

  it("hides the title below sm without taking it out of the accessibility tree", () => {
    // jsdom applies no CSS, so this pins the classes: `sr-only` keeps the h1
    // in the tree on a phone, where `hidden` (display: none) would drop the
    // route's only level-1 heading. It sits on the wrapper so `not-sr-only`
    // cannot undo the h1's own `truncate`.
    mockPathname.value = "/study";
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const h1 = within(screen.getByRole("banner")).getByRole("heading", {
      level: 1,
    });
    const wrapper = h1.parentElement as HTMLElement;
    expect(wrapper.className).toMatch(/(^|\s)sr-only(\s|$)/);
    expect(wrapper.className).toMatch(/\bsm:not-sr-only\b/);
    expect(`${wrapper.className} ${h1.className}`).not.toMatch(
      /(^|\s)hidden(\s|$)/,
    );
    expect(h1.className).toMatch(/\btruncate\b/);
  });

  it("keeps the find field centered at lg: both side cells flex-1", () => {
    // The find field is centered only because the two side cells grow equally.
    // Below sm the left cell is only the drawer trigger, so the field keeps
    // the rest of a phone-width bar.
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const cells = Array.from(screen.getByRole("banner").children);
    const left = cells[0] as HTMLElement;
    const right = cells[cells.length - 1] as HTMLElement;
    expect(left.className).toMatch(/\bsm:flex-1\b/);
    expect(left.className).toMatch(/\bshrink-0\b/);
    expect(right.className).toMatch(/\blg:flex-1\b/);
  });

  it("advertises no ⌘K affordance", () => {
    // #2141: kill the palette and the "Search (⌘K)" button.
    const { container } = render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(container.textContent).not.toContain("⌘K");
    expect(screen.queryByText(/Search \(/)).not.toBeInTheDocument();
  });

  it("does not answer Cmd+K", () => {
    // There was exactly one global keydown listener in the app and it toggled
    // the palette. Nothing may open on the chord now.
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("carries the find field, Ask and the account avatar in the bar", () => {
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const banner = screen.getByRole("banner");
    // The field-shaped button that opens the Find dialog.
    expect(banner).toContainElement(
      screen.getByRole("button", { name: /^Find channels/ }),
    );
    expect(
      screen.getByRole("button", { name: /Ask a question/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /account menu/i }),
    ).toBeInTheDocument();
  });

  it("keeps the skip link ahead of the content", () => {
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(
      screen.getByRole("link", { name: /skip to main content/i }),
    ).toHaveAttribute("href", "#main-content");
  });

  it("takes the full viewport and marks itself for the connection pill", () => {
    // The connection pill takes no row of its own, so the shell makes no room
    // for it. The shell used to subtract `--offline-banner-height`, which is
    // what moved the whole shell down every time the app left ONLINE. The
    // attribute is how the root layout's floating pill knows to stand down
    // while the top bar carries one.
    const { container } = render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const root = container.firstElementChild;
    // `dvh`: `100vh` on a phone is the viewport with the toolbar hidden, which
    // puts the bottom of a clipped shell under the toolbar while it shows.
    expect(root).toHaveClass("h-dvh");
    expect(root?.className).not.toContain("h-screen");
    expect(root?.className).not.toContain("offline-banner-height");
    expect(root).toHaveAttribute(DASHBOARD_SHELL_ATTR);
  });

  it("carries the connection pill in the top bar", () => {
    network.state = "OFFLINE";
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const bar = screen.getByRole("banner");
    expect(
      within(bar).getByRole("button", { name: /You're offline/ }),
    ).toHaveAttribute(CONNECTION_PILL_ATTR);
    network.state = "ONLINE";
  });

  /*
   * The full-bleed contract, added by #2142. Chat is drawn as three flush
   * columns at 100vh with a composer pinned to the bottom of the viewport
   * (`1b`), which it cannot be while `<main>` insets it and scrolls it. These
   * pin both halves, because getting either wrong is invisible in a unit test
   * of chat itself: the padding just reappears around a layout that still
   * "works".
   */
  it("insets and scrolls an ordinary route", () => {
    mockPathname.value = "/events";
    render(<DashboardShell>content</DashboardShell>);

    const main = screen.getByRole("main");
    expect(main.className).toContain("overflow-y-auto");
    expect(main.className).toContain("px-4");
  });

  it("hands a full-bleed route the frame, with no inset and no scroll of its own", () => {
    mockPathname.value = "/chat";
    render(<DashboardShell>content</DashboardShell>);

    const main = screen.getByRole("main");
    expect(main.className).toContain("overflow-hidden");
    expect(main.className).not.toContain("px-4");
    expect(main.className).not.toContain("overflow-y-auto");
    // Still the same landmark, and still the skip link's target.
    expect(main).toHaveAttribute("id", "main-content");
  });

  it("honours the server-read collapse preference on first render", () => {
    // Read from a cookie by the dashboard layout so the first paint is already
    // the right width. If this regressed to a client-side read, the nav would
    // render at 240px and snap to 56px after hydration on every route.
    render(
      <DashboardShell defaultNavCollapsed>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(
      screen.getByRole("button", { name: /expand navigation/i }),
    ).toBeInTheDocument();
  });

  describe("on /chat, the left column is the channel list (owner, 2026-11-05)", () => {
    it("shows the channels face and keeps the module nav inert behind it", () => {
      mockPathname.value = "/chat";
      const { container } = render(<DashboardShell>content</DashboardShell>);

      const slot = container.querySelector("[data-nav-channels-slot]");
      expect(slot).not.toBeNull();
      // The face holding the module nav is out of view and out of reach.
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(nav.closest("[inert]")).not.toBeNull();
      expect(slot!.closest("[inert]")).toBeNull();
      // No collapse toggle: in Chat the column is always the 240px list.
      expect(
        screen.queryByRole("button", { name: /collapse navigation/i }),
      ).not.toBeInTheDocument();
    });

    it("slides the modules in from the back arrow, and Chat slides the channels back", () => {
      mockPathname.value = "/chat";
      const { container } = render(
        <DashboardShell>
          <BackToMenu />
        </DashboardShell>,
      );
      const slot = container.querySelector("[data-nav-channels-slot]")!;

      fireEvent.click(
        screen.getByRole("button", { name: "Chat pane back arrow" }),
      );
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(nav.closest("[inert]")).toBeNull();
      expect(slot.closest("[inert]")).not.toBeNull();
      // Every other row still navigates.
      expect(within(nav).getByRole("link", { name: "Events" })).toHaveAttribute(
        "href",
        "/events",
      );

      // Chat acts in place: a link to /chat would drop a `?channel=` deep link.
      const chatRow = within(nav).getByRole("button", { name: /^Chat/ });
      expect(chatRow).toHaveAttribute("aria-current", "page");
      fireEvent.click(chatRow);
      expect(slot.closest("[inert]")).toBeNull();
      expect(nav.closest("[inert]")).not.toBeNull();
    });

    it("marks the Chat row unread only for a channel that isn't muted", () => {
      mockPathname.value = "/chat";
      mockUnread.value = [
        { channel_id: "c1", unread_count: 3, mention_count: 0 },
      ];
      mockLevels.value = [{ channel_id: "c1", level: "off" }];
      const { unmount } = render(<DashboardShell>content</DashboardShell>);
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(
        within(nav).getByRole("button", { name: /^Chat/ }),
      ).not.toHaveAccessibleName(/unread/);
      unmount();

      mockLevels.value = [];
      render(<DashboardShell>content</DashboardShell>);
      expect(
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
          "button",
          { name: /^Chat/ },
        ),
      ).toHaveAccessibleName(/unread messages/);
    });

    it("opens on the channels again after leaving Chat from the module face", () => {
      mockPathname.value = "/chat";
      const { container, rerender } = render(
        <DashboardShell>
          <BackToMenu />
        </DashboardShell>,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Chat pane back arrow" }),
      );

      // Leave by a module row, then come back: the common path out and in.
      mockPathname.value = "/events";
      rerender(
        <DashboardShell>
          <BackToMenu />
        </DashboardShell>,
      );
      mockPathname.value = "/chat";
      rerender(
        <DashboardShell>
          <BackToMenu />
        </DashboardShell>,
      );
      const slot = container.querySelector("[data-nav-channels-slot]")!;
      expect(slot.closest("[inert]")).toBeNull();
    });

    it("moves focus with the slide, and keeps a way back while chat is not mounted", () => {
      mockPathname.value = "/chat";
      render(<DashboardShell>content</DashboardShell>);

      // No chat pane in the slot (loading, or a failed segment): the column's
      // own placeholder still offers the back arrow.
      const back = screen.getByRole("button", { name: "Back to menu" });
      back.focus();
      fireEvent.click(back);
      const nav = screen.getByRole("navigation", { name: "Primary" });
      const chatRow = within(nav).getByRole("button", { name: /^Chat/ });
      expect(document.activeElement).toBe(chatRow);

      // With no pane the placeholder's arrow is the only one, and it hides
      // the moment a pane lands, so the face itself takes focus; the next Tab
      // reaches whichever arrow is showing.
      fireEvent.click(chatRow);
      expect(document.activeElement).toBe(back.closest("[tabindex='-1']"));
    });

    it("hands focus to chat's own back arrow once its pane is in the slot", () => {
      mockPathname.value = "/chat";
      function Pane() {
        const navFace = useNavFace();
        if (!navFace?.channelsSlot) return null;
        return createPortal(
          <button type="button" data-nav-back="" onClick={navFace.showModules}>
            Pane back arrow
          </button>,
          navFace.channelsSlot,
        );
      }
      render(
        <DashboardShell>
          <Pane />
        </DashboardShell>,
      );
      const back = screen.getByRole("button", { name: "Pane back arrow" });
      back.focus();
      fireEvent.click(back);
      const chatRow = within(
        screen.getByRole("navigation", { name: "Primary" }),
      ).getByRole("button", { name: /^Chat/ });
      expect(document.activeElement).toBe(chatRow);
      fireEvent.click(chatRow);
      expect(document.activeElement).toBe(back);
    });

    it("leaves focus alone when the channels come back from outside the column", () => {
      mockPathname.value = "/chat";
      // What chat does when a link lands: bring the channels back from the
      // route, with focus somewhere in the page rather than in the column.
      function LinkLands() {
        const navFace = useNavFace();
        return (
          <button type="button" onClick={() => navFace?.showChannels()}>
            Open a link
          </button>
        );
      }
      render(
        <DashboardShell>
          <LinkLands />
        </DashboardShell>,
      );
      const back = screen.getByRole("button", { name: "Back to menu" });
      back.focus();
      fireEvent.click(back);

      const outside = screen.getByRole("button", { name: "Open a link" });
      outside.focus();
      fireEvent.click(outside);
      expect(document.activeElement).toBe(outside);
      expect(back.closest("[inert]")).toBeNull();
    });

    it("keeps the chapter switcher pinned above the channels", () => {
      mockPathname.value = "/chat";
      mockChapter.value = { name: "Alpha Beta Gamma" };
      const { container } = render(<DashboardShell>content</DashboardShell>);
      const switcher = screen.getByRole("button", { name: /chapter menu/i });
      expect(switcher.closest("[inert]")).toBeNull();
      const slot = container.querySelector("[data-nav-channels-slot]")!;
      // Before the channels in document order, outside both faces.
      expect(
        switcher.compareDocumentPosition(slot) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("lets a mention or a DM through a mute, and lights nothing on unknown levels", () => {
      mockPathname.value = "/chat";
      const chatRowName = () =>
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
          "button",
          { name: /^Chat/ },
        );

      // A mention in a muted channel still addresses the member.
      mockUnread.value = [
        { channel_id: "c1", unread_count: 1, mention_count: 1 },
      ];
      mockLevels.value = [{ channel_id: "c1", level: "off" }];
      const first = render(<DashboardShell>content</DashboardShell>);
      expect(chatRowName()).toHaveAccessibleName(/unread messages/);
      first.unmount();

      // So does anything unread in a DM, muted or not.
      mockUnread.value = [
        { channel_id: "d1", unread_count: 2, mention_count: 0 },
      ];
      mockLevels.value = [{ channel_id: "d1", level: "off" }];
      mockChannels.value = [{ id: "d1", type: "DM" }];
      const second = render(<DashboardShell>content</DashboardShell>);
      expect(chatRowName()).toHaveAccessibleName(/unread messages/);
      second.unmount();

      // Plain unread with levels never loaded could be a muted channel.
      mockUnread.value = [
        { channel_id: "c2", unread_count: 4, mention_count: 0 },
      ];
      mockLevels.value = undefined;
      mockChannels.value = [];
      render(<DashboardShell>content</DashboardShell>);
      expect(chatRowName()).not.toHaveAccessibleName(/unread/);
    });

    it("gives every other route the module nav, with no nav face for the page", () => {
      mockPathname.value = "/events";
      const { container } = render(
        <DashboardShell>
          <BackToMenu />
        </DashboardShell>,
      );
      // The channels face stays mounted, out of view and out of reach, so
      // arriving at Chat slides it in rather than swapping the column.
      const slot = container.querySelector("[data-nav-channels-slot]");
      expect(slot!.closest("[inert]")).not.toBeNull();
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(nav.closest("[inert]")).toBeNull();
      expect(screen.getByText("no nav face")).toBeInTheDocument();
      expect(within(nav).getByRole("link", { name: "Chat" })).toHaveAttribute(
        "href",
        "/chat",
      );
    });

    it("keeps one column across Chat and every other route (Paul, 2026-11-06)", () => {
      // The jump: Chat used to swap a 240px column with a hairlined 48px
      // chapter band for a 220px nav with its chapter row in 8px of padding.
      mockPathname.value = "/events";
      const { container, rerender } = render(
        <DashboardShell>content</DashboardShell>,
      );
      const column = () =>
        container
          .querySelector("[data-nav-channels-slot]")!
          .closest(".border-r") as HTMLElement;
      const switcher = () =>
        screen.getByRole("button", { name: /chapter menu/i });
      // The geometry the jump was made of: the 48px hairlined band, and the
      // modules face with no top padding of its own, so the first row sits
      // 52px down. Checked on every route, since a per-route class is how it
      // could come back.
      const expectGeometry = () => {
        expect(column().className).toContain("w-60");
        const band = switcher().closest(".border-b") as HTMLElement;
        expect(band.className).toMatch(/\bmin-h-12\b/);
        expect(band.className).toMatch(/\bpt-1\b/);
        const face = screen.getByRole("navigation", { name: "Primary" })
          .parentElement!.parentElement!;
        expect(face.className).toMatch(/\bpt-0\b/);
      };
      const before = { column: column(), switcher: switcher() };
      expectGeometry();

      mockPathname.value = "/chat";
      rerender(<DashboardShell>content</DashboardShell>);
      // The same nodes: nothing was unmounted, so nothing can jump.
      expect(column()).toBe(before.column);
      expect(switcher()).toBe(before.switcher);
      expectGeometry();

      mockPathname.value = "/tasks";
      rerender(<DashboardShell>content</DashboardShell>);
      expect(column()).toBe(before.column);
      expect(switcher()).toBe(before.switcher);
      expectGeometry();
    });

    it("binds chat's inbox and reads its unread counts on every route, and draws no placeholder off Chat (#3745)", () => {
      realtimeBinding.calls = 0;
      mockPathname.value = "/events";
      render(<DashboardShell>content</DashboardShell>);
      // Off `/chat` the inbox is joined and the counts read, so a message
      // arriving while the member is on Events lights the Chat row.
      expect(realtimeBinding.calls).toBeGreaterThan(0);
      expect(unreadReads.count).toBeGreaterThan(0);
      // The placeholder's skeleton would shimmer out of view on every route.
      expect(
        screen.queryByRole("button", { name: "Back to menu" }),
      ).not.toBeInTheDocument();
    });

    it("lights the Chat row off /chat, as a link, until the counts clear (#3824)", () => {
      mockPathname.value = "/events";
      mockLevels.value = [];
      mockChannels.value = [{ id: "d1", type: "DM" }];
      mockUnread.value = [
        { channel_id: "d1", unread_count: 2, mention_count: 0 },
      ];
      const { container, rerender } = render(
        <DashboardShell>content</DashboardShell>,
      );
      const chatLink = () =>
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
          "link",
          { name: /^Chat/ },
        );
      expect(chatLink()).toHaveAccessibleName(/unread messages/);
      expect(chatLink()).toHaveClass("font-semibold", "text-foreground");
      expect(
        chatLink().querySelector("[data-nav-highlight]"),
      ).toBeInTheDocument();

      // Read elsewhere (the counts are the server's): the row goes quiet.
      mockUnread.value = [];
      rerender(<DashboardShell>content</DashboardShell>);
      expect(chatLink()).not.toHaveAccessibleName(/unread/);
      expect(
        container.querySelector("[data-nav-highlight]"),
      ).not.toBeInTheDocument();
    });

    it("lights the Chat row in the collapsed rail and in the drawer too (#3824)", () => {
      mockPathname.value = "/events";
      mockLevels.value = [];
      mockChannels.value = [{ id: "d1", type: "DM" }];
      mockUnread.value = [
        { channel_id: "d1", unread_count: 2, mention_count: 0 },
      ];
      render(<DashboardShell defaultNavCollapsed>content</DashboardShell>);

      // The rail's `aria-label` replaces the row's words, so it carries them.
      const rail = screen.getByRole("navigation", { name: "Primary" });
      expect(
        within(rail).getByRole("link", { name: "Chat, unread messages" }),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );
      const drawer = screen.getByRole("dialog");
      expect(
        within(drawer).getByRole("link", { name: /^Chat.*unread messages/ }),
      ).toBeInTheDocument();
    });

    it("arriving at Chat with focus in the nav keeps it in the column, not on a placeholder", () => {
      mockPathname.value = "/events";
      const { container, rerender } = render(
        <DashboardShell>content</DashboardShell>,
      );
      // Browser Back to Chat while a row other than Chat's has focus (the
      // Chat row itself turns from a link into a button on arrival, so its
      // focus is gone before the face changes).
      within(screen.getByRole("navigation", { name: "Primary" }))
        .getByRole("link", { name: "Tasks" })
        .focus();

      // Chat's route is still loading: the slot is empty and only the
      // placeholder's arrow exists, which hides once the pane lands.
      mockPathname.value = "/chat";
      rerender(<DashboardShell>content</DashboardShell>);
      const face = container.querySelector(
        "[data-nav-channels-slot]",
      )!.parentElement!;
      expect(document.activeElement).toBe(face);
      expect(face.closest("[inert]")).toBeNull();
    });

    it("lets the rail apply off Chat only", () => {
      mockPathname.value = "/events";
      const { container, rerender } = render(
        <DashboardShell defaultNavCollapsed>content</DashboardShell>,
      );
      const column = () =>
        container
          .querySelector("[data-nav-channels-slot]")!
          .closest(".border-r") as HTMLElement;
      expect(column().className).toContain("w-14");

      mockPathname.value = "/chat";
      rerender(<DashboardShell defaultNavCollapsed>content</DashboardShell>);
      expect(column().className).toContain("w-60");
      expect(
        screen.queryByRole("button", { name: /expand navigation/i }),
      ).not.toBeInTheDocument();
    });
  });
});
