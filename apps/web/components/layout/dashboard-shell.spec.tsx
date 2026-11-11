import { afterEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

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
const routerPush = vi.hoisted(() => vi.fn());
const mockSearch = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(mockSearch.value),
}));
// Chat's panel has its own specs (`chat-shell.spec.tsx`); here it is a stub
// that reports what the shell hands it.
vi.mock("@/components/chat/chat-page", () => ({
  ChatPage: ({ toolBeside }: { toolBeside?: boolean }) => (
    <p data-testid="chat-stub">{toolBeside ? "beside a tool" : "alone"}</p>
  ),
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
    // The What's new host (#4043): the account hasn't answered.
    useAccountWhatsNewSeen: () => ({ settled: false, seen: undefined }),
    useRecordWhatsNewSeen: () => ({ mutate: () => {} }),
    useMemberDisplayNames: () => ({ avatarTintFor: () => null }),
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
// The account menu's own status (#3845) reads the settings query; its rows
// are `account-menu.spec.tsx`'s subject, not the shell's.
vi.mock("@/lib/realtime/use-own-status", () => ({
  useOwnStatus: () => null,
  useSaveOwnStatus: () => ({ save: vi.fn(), isSaving: false }),
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "me" }),
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

import { signetDarkTokens } from "@repo/theme/signet";
import { DashboardShell } from "./dashboard-shell";
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
  routerPush.mockClear();
  mockSearch.value = "";
  setWindowWidth(null);
  document.cookie = "frapp_chat_open=; Max-Age=0; Path=/";
  document.cookie = "frapp_chat_split=; Max-Age=0; Path=/";
});

/**
 * jsdom has no `matchMedia`, which the shell reads as "width not known yet"
 * (the server and hydration case). A number answers every `min-width` query
 * as a window of that width would.
 */
function setWindowWidth(px: number | null) {
  if (px === null) {
    // @ts-expect-error -- jsdom ships none; restore that.
    delete window.matchMedia;
    return;
  }
  window.matchMedia = ((query: string) => ({
    matches: px >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
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
      within(banner).queryByRole("link", { name: "Chapter settings" }),
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
      within(banner).getByRole("link", { name: "Chapter settings" }),
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
      within(banner).queryByRole("link", { name: "Chapter settings" }),
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
  it("insets and scrolls a tool page, inside the one main landmark", () => {
    mockPathname.value = "/events";
    const { container } = render(<DashboardShell>content</DashboardShell>);

    const page = container.querySelector("[data-tool-page]") as HTMLElement;
    expect(page.className).toContain("overflow-y-auto");
    expect(page.className).toContain("px-4");
    // `<main>` is the whole row (chat, divider, page), flush and unscrolled.
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toContainElement(page);
    expect(main.className).not.toContain("px-4");
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
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });


  describe("chat beside the chapter tools (#3779)", () => {
    const nav = () => screen.getByRole("navigation", { name: "Primary" });
    const column = (container: HTMLElement) =>
      container.querySelector("[data-nav-column]") as HTMLElement;
    const chatPanel = (container: HTMLElement) =>
      container.querySelector("[data-chat-panel]") as HTMLElement | null;

    it("hosts chat alone on /chat, inside main, so the skip link, focus fallback and floor suite reach it", () => {
      mockPathname.value = "/chat";
      const { container } = render(<DashboardShell>{null}</DashboardShell>);
      expect(chatPanel(container)).not.toBeNull();
      expect(screen.getByTestId("chat-stub")).toHaveTextContent("alone");
      const main = screen.getByRole("main");
      expect(main).toContainElement(chatPanel(container));
      expect(main.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      expect(
        screen.getByRole("link", { name: "Skip to main content" }),
      ).toHaveAttribute("href", "#main-content");
      expect(container.querySelector("[data-tool-page]")).toBeNull();
    });

    it("opens chat on a fresh load of a chat deep link, even with the cookie closed", () => {
      setWindowWidth(1440);
      mockPathname.value = "/chat";
      mockSearch.value = "channel=c1";
      const { container } = render(
        <DashboardShell defaultChatOpen={false}>{null}</DashboardShell>,
      );
      expect(chatPanel(container)).not.toBeNull();
      expect(container.querySelector("[data-chapter-home]")).toBeNull();
    });

    it("keeps /chat the chat page below the side-by-side width, whatever the cookie says", () => {
      setWindowWidth(1024);
      mockPathname.value = "/chat";
      const { container } = render(
        <DashboardShell defaultChatOpen={false}>{null}</DashboardShell>,
      );
      expect(chatPanel(container)).not.toBeNull();
      // Below the width the Chat row is the link it always was.
      expect(within(nav()).getByRole("link", { name: "Chat" })).toHaveAttribute(
        "href",
        "/chat",
      );
    });

    it("opens chat beside a tool, with the divider, and only from the side-by-side width", () => {
      mockPathname.value = "/events";
      const { container } = render(
        <DashboardShell>
          <p>events page</p>
        </DashboardShell>,
      );
      // Width unknown (server, hydration): the panel holds its place by CSS
      // with chat's skeleton, and chat itself waits for a known-wide window,
      // so a phone never builds a chat it cannot show.
      expect(chatPanel(container)).toHaveClass("hidden", "min-[1056px]:flex");
      expect(screen.queryByTestId("chat-stub")).not.toBeInTheDocument();
      expect(screen.getByRole("separator")).toBeInTheDocument();
      expect(screen.getByText("events page")).toBeInTheDocument();
      // Both floors: the page keeps 375px, and chat its channels plus 375px.
      expect(container.querySelector("[data-tool-column]")).toHaveClass(
        "min-[1056px]:min-w-[375px]",
      );
      expect(chatPanel(container)!.style.minWidth).toBe("615px");
    });

    describe("closing the tool page from the page itself (Paul, 2026-11-11)", () => {
      it("gives every tool page a close button and its title in its own header", () => {
        setWindowWidth(1440);
        // Chat admin has no nav row of its own to click closed.
        mockPathname.value = "/chat-admin";
        mockPermissions.value = ["chat:manage"];
        const { container } = render(<DashboardShell>admin</DashboardShell>);
        const header = container.querySelector(
          "[data-tool-page-header]",
        ) as HTMLElement;
        expect(header).toHaveClass("hidden", "min-[1056px]:flex");
        // One h1, and once the window is known to be wide it is the page's.
        const headings = screen.getAllByRole("heading", { level: 1 });
        expect(headings).toHaveLength(1);
        expect(header).toContainElement(headings[0]!);
        expect(headings[0]).toHaveTextContent("Chat admin");
        // The top bar's copy steps aside at the same width, by CSS.
        const barCopy = within(screen.getByRole("banner")).getByText(
          "Chat admin",
        );
        expect(barCopy.tagName).toBe("P");
        expect(barCopy.parentElement).toHaveClass("min-[1056px]:hidden");

        fireEvent.click(
          within(header).getByRole("button", { name: "Close Chat admin" }),
        );
        expect(routerPush).toHaveBeenCalledWith("/chat");
      });

      it("keeps the title the top bar's h1 until the window is known to be wide", () => {
        setWindowWidth(null);
        mockPathname.value = "/events";
        render(<DashboardShell>events</DashboardShell>);
        expect(
          within(screen.getByRole("banner")).getByRole("heading", { level: 1 }),
        ).toHaveTextContent("Events");
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      });

      it("closes on Escape inside the page, but not from a field or below the side-by-side width", () => {
        setWindowWidth(1440);
        mockPathname.value = "/events";
        const { rerender } = render(
          <DashboardShell>
            <button type="button">page button</button>
            <input aria-label="page field" />
          </DashboardShell>,
        );
        fireEvent.keyDown(screen.getByRole("textbox", { name: "page field" }), {
          key: "Escape",
        });
        expect(routerPush).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole("button", { name: "page button" }), {
          key: "Escape",
        });
        expect(routerPush).toHaveBeenCalledWith("/chat");

        routerPush.mockClear();
        setWindowWidth(1024);
        mockPathname.value = "/tasks";
        rerender(
          <DashboardShell>
            <button type="button">page button</button>
          </DashboardShell>,
        );
        fireEvent.keyDown(screen.getByRole("button", { name: "page button" }), {
          key: "Escape",
        });
        expect(routerPush).not.toHaveBeenCalled();
      });

      it("closes the page when the divider is let go at the right edge", () => {
        setWindowWidth(1440);
        mockPathname.value = "/events";
        const { container } = render(<DashboardShell>events</DashboardShell>);
        const main = screen.getByRole("main");
        main.getBoundingClientRect = () =>
          ({ width: 1200, left: 240, right: 1440 }) as DOMRect;
        const divider = screen.getByRole("separator");
        divider.setPointerCapture = () => {};
        divider.hasPointerCapture = () => false;
        fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 900 });
        fireEvent.pointerMove(divider, { pointerId: 1, clientX: 1430 });
        // The page fades first, so the release is no surprise.
        expect(container.querySelector("[data-tool-column]")).toHaveClass(
          "opacity-40",
        );
        fireEvent.pointerUp(divider, { pointerId: 1, clientX: 1430 });
        expect(routerPush).toHaveBeenCalledWith("/chat");
      });
    });

    it("mounts chat beside the tool once the window is known to be wide", () => {
      setWindowWidth(1440);
      mockPathname.value = "/events";
      render(<DashboardShell>events</DashboardShell>);
      expect(screen.getByTestId("chat-stub")).toHaveTextContent(
        "beside a tool",
      );
    });

    it("drops chat beside a tool once the window is known to be narrow", () => {
      setWindowWidth(1024);
      mockPathname.value = "/events";
      const { container } = render(<DashboardShell>events</DashboardShell>);
      expect(chatPanel(container)).toBeNull();
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("toggles chat from its nav row, and the open tool's row closes the tool", () => {
      vi.useFakeTimers();
      try {
        setWindowWidth(1440);
        mockPathname.value = "/events";
        const { container } = render(<DashboardShell>events</DashboardShell>);
        const chatRow = within(nav()).getByRole("button", { name: /^Chat/ });
        expect(chatRow).toHaveAttribute("aria-pressed", "true");

        // A page load paints chat in place: no entrance.
        expect(chatPanel(container)!.style.animation).toBe("");
        fireEvent.click(chatRow);
        // It plays its exit on Signet's exit ease, inert, then goes.
        expect(chatPanel(container)).toHaveAttribute("inert");
        expect(chatPanel(container)!.style.animation).toContain(
          "shell-panel-out",
        );
        expect(chatPanel(container)!.style.animation).toContain(
          signetDarkTokens.motion.easing.exit,
        );
        act(() => {
          vi.runAllTimers();
        });
        expect(chatPanel(container)).toBeNull();
        expect(
          within(nav()).getByRole("button", { name: /^Chat/ }),
        ).toHaveAttribute("aria-pressed", "false");
        expect(document.cookie).toContain("frapp_chat_open=0");

        // Opening from the row plays the entrance: `context` on the entrance
        // ease, never the `settle` overshoot (that one needs Paul).
        fireEvent.click(within(nav()).getByRole("button", { name: /^Chat/ }));
        const anim = chatPanel(container)!.style.animation;
        expect(anim).toContain("shell-panel-in");
        expect(anim).toContain(
          `${signetDarkTokens.motion.duration.context}ms`,
        );
        expect(anim).toContain(signetDarkTokens.motion.easing.entrance);
        expect(anim).not.toContain(signetDarkTokens.motion.easing.settle);
        // jsdom has no AnimationEvent, so React listens for the prefixed
        // name; dispatch both.
        for (const type of ["animationend", "webkitAnimationEnd"]) {
          fireEvent(chatPanel(container)!, new Event(type, { bubbles: true }));
        }
        expect(chatPanel(container)!.style.animation).toBe("");
        fireEvent.click(within(nav()).getByRole("button", { name: /^Chat/ }));
        act(() => {
          vi.runAllTimers();
        });

        // The open tool's row is a toggle too: it goes to `/chat`, no tool.
        const events = within(nav()).getByRole("button", { name: "Events" });
        expect(events).toHaveAttribute("title", "Close Events");
        fireEvent.click(events);
        expect(routerPush).toHaveBeenCalledWith("/chat");
        // Every other tool row still navigates.
        expect(
          within(nav()).getByRole("link", { name: "Tasks" }),
        ).toHaveAttribute("href", "/tasks");
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows the home view when closing a tool leaves nothing open, and opens chat on any other arrival at /chat", () => {
      setWindowWidth(1440);
      mockPathname.value = "/events";
      const { container, rerender } = render(
        <DashboardShell defaultChatOpen={false}>events</DashboardShell>,
      );
      fireEvent.click(within(nav()).getByRole("button", { name: "Events" }));
      mockPathname.value = "/chat";
      rerender(<DashboardShell defaultChatOpen={false}>{null}</DashboardShell>);
      expect(chatPanel(container)).toBeNull();
      expect(
        container.querySelector("[data-chapter-home]"),
      ).toBeInTheDocument();

      // A link to Chat from anywhere else opens it.
      mockPathname.value = "/tasks";
      rerender(<DashboardShell defaultChatOpen={false}>tasks</DashboardShell>);
      mockPathname.value = "/chat";
      rerender(<DashboardShell defaultChatOpen={false}>{null}</DashboardShell>);
      expect(chatPanel(container)).not.toBeNull();
    });

    it("drops the nav to its rail while chat and a tool share a window without room for it", () => {
      setWindowWidth(1100);
      mockPathname.value = "/events";
      const { container, rerender } = render(
        <DashboardShell>events</DashboardShell>,
      );
      expect(column(container)).toHaveClass("w-14");
      // Forced, not the member's preference: no toggle to undo it.
      expect(
        screen.queryByRole("button", { name: /expand sidebar/i }),
      ).not.toBeInTheDocument();

      // Chat alone has room: the nav comes back.
      mockPathname.value = "/chat";
      rerender(<DashboardShell>{null}</DashboardShell>);
      expect(column(container)).toHaveClass("w-60");

      // And at a wide window it never drops.
      setWindowWidth(1440);
      mockPathname.value = "/events";
      rerender(<DashboardShell>events</DashboardShell>);
      expect(column(container)).toHaveClass("w-60");
    });

    it("paints the forced rail on the server, by CSS, and keeps that column through hydration (#4024)", async () => {
      // The server knows the route and the chat cookie, not the width. It
      // used to paint the full nav, which at 1100px clipped ~130px off the
      // tool page until hydration snapped the nav to its rail.
      mockPathname.value = "/events";
      const host = document.createElement("div");
      host.innerHTML = renderToString(<DashboardShell>events</DashboardShell>);
      document.body.appendChild(host);
      try {
        const served = Array.from(
          host.querySelectorAll<HTMLElement>("[data-nav-column]"),
        );
        expect(served).toHaveLength(2);
        const [full, rail] = served;
        // Both answers, the band's CSS picking one: the rail only from 1056
        // to 1239px, the full nav everywhere else.
        expect(full).toHaveClass("w-60", "min-[1056px]:max-[1240px]:hidden");
        expect(rail).toHaveClass(
          "w-14",
          "hidden",
          "min-[1056px]:max-[1240px]:flex",
        );
        expect(rail).not.toHaveClass("flex");

        // Hydrated at 1100px: only the rail stays, the same node, so the
        // frame the server painted is the frame that stays.
        setWindowWidth(1100);
        const root = await act(async () =>
          hydrateRoot(host, <DashboardShell>events</DashboardShell>),
        );
        const left = host.querySelectorAll<HTMLElement>("[data-nav-column]");
        expect(left).toHaveLength(1);
        expect(left[0]).toBe(rail);
        expect(left[0]).toHaveClass("w-14", "flex");
        expect(left[0]).not.toHaveClass("hidden");
        act(() => root.unmount());
      } finally {
        host.remove();
      }
    });

    it("hydrates to the full nav, the same node, where the window has room for it", async () => {
      mockPathname.value = "/events";
      const host = document.createElement("div");
      host.innerHTML = renderToString(<DashboardShell>events</DashboardShell>);
      document.body.appendChild(host);
      try {
        const full = host.querySelector<HTMLElement>("[data-nav-column]");
        setWindowWidth(1440);
        const root = await act(async () =>
          hydrateRoot(host, <DashboardShell>events</DashboardShell>),
        );
        const left = host.querySelectorAll<HTMLElement>("[data-nav-column]");
        expect(left).toHaveLength(1);
        expect(left[0]).toBe(full);
        expect(left[0]).toHaveClass("w-60");
        expect(left[0]!.className).not.toContain("max-[1240px]");
        act(() => root.unmount());
      } finally {
        host.remove();
      }
    });

    it("draws one column on the server where no rail can be forced", () => {
      // Chat closed beside a tool, and chat alone on /chat: the full nav at
      // every width, so no band CSS and no second column.
      for (const [path, chatOpen] of [
        ["/events", false],
        ["/chat", true],
      ] as const) {
        mockPathname.value = path;
        const host = document.createElement("div");
        host.innerHTML = renderToString(
          <DashboardShell defaultChatOpen={chatOpen}>{null}</DashboardShell>,
        );
        const served = host.querySelectorAll("[data-nav-column]");
        expect(served, path).toHaveLength(1);
        expect(served[0]!.className, path).not.toContain("max-[1240px]");
      }
    });

    it("keeps the member's own rail through hydration in the band", async () => {
      mockPathname.value = "/events";
      const host = document.createElement("div");
      const shell = <DashboardShell defaultNavCollapsed>events</DashboardShell>;
      host.innerHTML = renderToString(shell);
      document.body.appendChild(host);
      try {
        const served = host.querySelector<HTMLElement>("[data-nav-column]");
        setWindowWidth(1100);
        const root = await act(async () => hydrateRoot(host, shell));
        const left = host.querySelectorAll<HTMLElement>("[data-nav-column]");
        expect(left).toHaveLength(1);
        expect(left[0]).toBe(served);
        expect(left[0]).toHaveClass("w-14");
        act(() => root.unmount());
      } finally {
        host.remove();
      }
    });

    it("narrows the same nav column, without remounting it, when chat opens in the band", () => {
      // A remount would drop focus from the Chat row the member just pressed.
      setWindowWidth(1100);
      mockPathname.value = "/events";
      const { container } = render(
        <DashboardShell defaultChatOpen={false}>events</DashboardShell>,
      );
      const before = column(container);
      expect(before).toHaveClass("w-60");
      fireEvent.click(within(nav()).getByRole("button", { name: "Chat" }));
      expect(column(container)).toBe(before);
      expect(before).toHaveClass("w-14");
    });

    it("leaves the Settings row a link back to Settings on a Settings tool's page", () => {
      setWindowWidth(1440);
      mockPathname.value = "/reports";
      mockPermissions.value = ["reports:view", "chapter-config:view"];
      render(<DashboardShell>reports</DashboardShell>);
      expect(
        within(nav()).getByRole("link", { name: "Chapter settings" }),
      ).toHaveAttribute("href", "/settings");
      expect(
        within(nav()).queryByRole("button", { name: "Chapter settings" }),
      ).not.toBeInTheDocument();
    });

    it("remembers where the divider was left, in its cookie", () => {
      setWindowWidth(1440);
      mockPathname.value = "/events";
      render(<DashboardShell>events</DashboardShell>);
      fireEvent.keyDown(screen.getByRole("separator"), { key: "Enter" });
      expect(document.cookie).toContain("frapp_chat_split=0.500");
    });

    it("draws the chapter mark on the home view", () => {
      setWindowWidth(1440);
      mockPathname.value = "/chat";
      mockChapter.value = {
        id: "chap-1",
        name: "Alpha Beta",
        university: "State University",
        logo_url: null,
        branding: {},
        enabled_modules: [],
      };
      const { container } = render(
        <DashboardShell defaultChatOpen={false}>{null}</DashboardShell>,
      );
      const home = container.querySelector("[data-chapter-home]")!;
      expect(home).toBeInTheDocument();
      expect(
        within(home as HTMLElement).getByTestId("chapter-mark-text"),
      ).toHaveClass("h-28", "bg-accent-subtle", "text-accent-text");
      expect(home).toHaveTextContent("Alpha Beta");
      expect(home).toHaveTextContent("State University");
      // The top bar names no page over it.
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    });

    it("keeps one nav column across Chat and every other route (Paul, 2026-11-06)", () => {
      mockPathname.value = "/events";
      const { container, rerender } = render(
        <DashboardShell>content</DashboardShell>,
      );
      const switcher = () =>
        screen.getByRole("button", { name: /chapter menu/i });
      const before = { column: column(container), switcher: switcher() };
      for (const path of ["/chat", "/tasks"]) {
        mockPathname.value = path;
        rerender(<DashboardShell>content</DashboardShell>);
        // The same nodes: nothing was unmounted, so nothing can jump.
        expect(column(container)).toBe(before.column);
        expect(switcher()).toBe(before.switcher);
        expect(column(container)).toHaveClass("w-60");
        const band = switcher().closest(".border-b") as HTMLElement;
        expect(band.className).toMatch(/\bmin-h-12\b/);
      }
    });

    it("keeps the chat panel mounted across tool routes, so the conversation survives", () => {
      setWindowWidth(1440);
      mockPathname.value = "/events";
      const { container, rerender } = render(
        <DashboardShell>events</DashboardShell>,
      );
      const panel = chatPanel(container);
      mockPathname.value = "/tasks";
      rerender(<DashboardShell>tasks</DashboardShell>);
      expect(chatPanel(container)).toBe(panel);
    });
  });

  describe("the Chat row's unread highlight (#3824)", () => {
    const chatRow = () =>
      within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
        "link",
        { name: /^Chat/ },
      );

    it("marks the Chat row unread only for a channel that isn't muted", () => {
      mockUnread.value = [
        { channel_id: "c1", unread_count: 3, mention_count: 0 },
      ];
      mockLevels.value = [{ channel_id: "c1", level: "off" }];
      const { unmount } = render(<DashboardShell>content</DashboardShell>);
      expect(chatRow()).not.toHaveAccessibleName(/unread/);
      unmount();

      mockLevels.value = [];
      render(<DashboardShell>content</DashboardShell>);
      expect(chatRow()).toHaveAccessibleName(/unread messages/);
    });

    it("lets a mention or a DM through a mute, and lights nothing on unknown levels", () => {
      mockUnread.value = [
        { channel_id: "c1", unread_count: 1, mention_count: 1 },
      ];
      mockLevels.value = [{ channel_id: "c1", level: "off" }];
      const first = render(<DashboardShell>content</DashboardShell>);
      expect(chatRow()).toHaveAccessibleName(/unread messages/);
      first.unmount();

      mockUnread.value = [
        { channel_id: "d1", unread_count: 2, mention_count: 0 },
      ];
      mockLevels.value = [{ channel_id: "d1", level: "off" }];
      mockChannels.value = [{ id: "d1", type: "DM" }];
      const second = render(<DashboardShell>content</DashboardShell>);
      expect(chatRow()).toHaveAccessibleName(/unread messages/);
      second.unmount();

      mockUnread.value = [
        { channel_id: "c2", unread_count: 4, mention_count: 0 },
      ];
      mockLevels.value = undefined;
      mockChannels.value = [];
      render(<DashboardShell>content</DashboardShell>);
      expect(chatRow()).not.toHaveAccessibleName(/unread/);
    });

    it("binds chat's inbox and reads its unread counts on every route (#3745)", () => {
      realtimeBinding.calls = 0;
      render(<DashboardShell>content</DashboardShell>);
      expect(realtimeBinding.calls).toBeGreaterThan(0);
      expect(unreadReads.count).toBeGreaterThan(0);
    });

    it("lights the Chat row until the counts clear", () => {
      mockLevels.value = [];
      mockChannels.value = [{ id: "d1", type: "DM" }];
      mockUnread.value = [
        { channel_id: "d1", unread_count: 2, mention_count: 0 },
      ];
      const { container, rerender } = render(
        <DashboardShell>content</DashboardShell>,
      );
      expect(chatRow()).toHaveAccessibleName(/unread messages/);
      expect(chatRow()).toHaveClass("font-semibold", "text-foreground");
      mockUnread.value = [];
      rerender(<DashboardShell>content</DashboardShell>);
      expect(chatRow()).not.toHaveAccessibleName(/unread/);
      expect(
        container.querySelector("[data-nav-highlight]"),
      ).not.toBeInTheDocument();
    });

    it("lights the Chat row in the collapsed rail and in the drawer too", () => {
      mockLevels.value = [];
      mockChannels.value = [{ id: "d1", type: "DM" }];
      mockUnread.value = [
        { channel_id: "d1", unread_count: 2, mention_count: 0 },
      ];
      render(<DashboardShell defaultNavCollapsed>content</DashboardShell>);
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
  });
});
