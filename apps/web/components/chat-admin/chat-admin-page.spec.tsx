import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { denseListClassName } from "@/components/shared/table-controls";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { networkMock } from "@/tests/network";

/*
 * Chat Admin's channel structure (#2500): flush on the page surface, its
 * states from the nested family, a background read that fails keeps what is
 * already loaded, and the create dialog tells the three types apart truthfully.
 *
 * The report queue above it has its own spec (`chat-reports-card.spec.tsx`)
 * and is stubbed here; so is the screen-level `<Can>`, whose fallbacks
 * `can-fallback.spec.tsx` pins.
 */

const { mockOffline, reads } = vi.hoisted(() => ({
  mockOffline: { value: false },
  reads: {
    channels: {} as Record<string, unknown>,
    categories: {} as Record<string, unknown>,
    pins: {} as Record<string, unknown>,
    catalog: {} as Record<string, unknown>,
  },
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    resolveAuthorLabel: actual.resolveAuthorLabel,
    useChannels: () => reads.channels,
    useCategories: () => reads.categories,
    usePinnedMessages: () => reads.pins,
    usePermissionsCatalog: () => reads.catalog,
    useRoles: () => ({ data: [] }),
    useMemberDisplayNames: () => ({ nameFor: () => null }),
    useCreateChannel: mutation,
    useUpdateChannel: mutation,
    useDeleteChannel: mutation,
    useCreateCategory: mutation,
    useUpdateCategory: mutation,
    useDeleteCategory: mutation,
    useUnpinMessage: mutation,
  };
});

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./chat-reports-card", () => ({
  ChatReportsCard: () => <div data-testid="report-queue" />,
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { ChatAdminPage } = await import("./chat-admin-page");

const channel = (
  id: string,
  name: string,
  type: "PUBLIC" | "PRIVATE" | "ROLE_GATED",
) => ({
  id,
  name,
  description: null,
  type,
  required_permissions: null,
  category_id: "cat-1",
  is_read_only: false,
  default_notification_level: null,
});

const CHANNELS = [
  channel("ch-1", "general", "PUBLIC"),
  channel("ch-2", "exec", "PRIVATE"),
  {
    ...channel("ch-3", "officers", "ROLE_GATED"),
    required_permissions: ["members:view"],
  },
];
const CATALOG = [{ key: "members:view", permission: "members:view" }];
const CATEGORIES = [{ id: "cat-1", name: "Chapter", display_order: 0 }];

function settled(data: unknown) {
  return {
    data,
    isPending: false,
    isLoading: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  };
}

/** A read with nothing to show: what failed or paused before any data. */
function empty(overrides: Record<string, unknown>) {
  return { ...settled(undefined), ...overrides };
}

const CHANNELS_STALE =
  "Couldn't refresh the channels. These are the last ones that loaded.";

const PINS_STALE =
  "Couldn't refresh the pins. These are the last ones that loaded.";

const selectExec = () =>
  fireEvent.click(screen.getByRole("button", { name: /^#exec/ }));

beforeEach(() => {
  vi.clearAllMocks();
  mockOffline.value = false;
  reads.channels = settled(CHANNELS);
  reads.categories = settled(CATEGORIES);
  reads.pins = settled([]);
  reads.catalog = settled(CATALOG);
});

describe("ChatAdminPage — on the page surface (#2500)", () => {
  it("draws Channels and Categories as labelled sections, with no wrapper card and no narration", () => {
    const { container } = render(<ChatAdminPage />);

    expect(
      within(screen.getByRole("region", { name: "Channels" })).getByText(
        "#general",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Categories" })).getByText(
        "Chapter",
      ),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
    expect(screen.queryByText(/Create, edit, and delete channels/)).toBeNull();
  });

  it("shows the channel's type beside the edit heading, on the page surface", () => {
    const { container } = render(<ChatAdminPage />);
    selectExec();
    expect(cardFilledContainers(container)).toEqual([]);

    const pane = screen.getByRole("region", { name: "Edit #exec" });
    expect(
      within(pane).getByRole("heading", { level: 3, name: "Edit #exec" }),
    ).toBeInTheDocument();
    expect(within(pane).getByText("Private")).toBeInTheDocument();
  });
});

describe("ChatAdminPage — row heights", () => {
  // The Directory's row-as-control recipe for a channel (the button sets the
  // height: 36, 44 on touch) and the 44px floor for a category. Padding on
  // either row puts 8px on top of that.
  it("lets the controls set the row height, with no padding around them", () => {
    render(<ChatAdminPage />);

    const channelButton = screen.getByRole("button", { name: /^#exec/ });
    expect(channelButton.className).toContain("min-h-9");
    expect(channelButton.className).toContain("pointer-coarse:min-h-11");
    const channelRow = channelButton.closest("li") as HTMLElement;
    expect(channelRow.className).not.toMatch(/\bpy-/);

    const categoryRow = within(
      screen.getByRole("region", { name: "Categories" }),
    )
      .getByText("Chapter")
      .closest("li") as HTMLElement;
    expect(categoryRow.className).toContain("min-h-11");
    expect(categoryRow.className).not.toMatch(/\bpy-/);

    // Neither row has padding or a border of its own, so the lists' dividers
    // are what separate them.
    for (const item of [channelRow, categoryRow]) {
      expect((item.closest("ul") as HTMLElement).className).toContain(
        denseListClassName,
      );
    }
  });
});

describe("ChatAdminPage — the create dialog", () => {
  it("says a private channel is for its members, and that the type is final", () => {
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));

    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByText(/A private channel is readable only by its members/),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(/type can.t be changed after it.s created/),
    ).toBeInTheDocument();
    expect(dialog.queryByText(/visible to every member/)).toBeNull();
  });
});

describe("ChatAdminPage — the channel structure's states", () => {
  it("keeps the loaded channels through a failed background read, and says they are the last that loaded", () => {
    reads.channels = { ...settled(CHANNELS), isError: true };
    render(<ChatAdminPage />);

    expect(screen.getByText("#general")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load channels")).toBeNull();
    expect(screen.getByText(CHANNELS_STALE)).toBeInTheDocument();
  });

  it("has the notice's live region mounted before a read fails, so its line is announced", () => {
    const { container, rerender } = render(<ChatAdminPage />);
    const regions = [...container.querySelectorAll('[role="status"]')];

    reads.channels = { ...settled(CHANNELS), isError: true };
    rerender(<ChatAdminPage />);

    expect(regions).toContain(
      screen.getByText(CHANNELS_STALE).closest('[role="status"]'),
    );
  });

  it("says a chapter has no channels or categories yet, in the nested family", () => {
    reads.channels = settled([]);
    reads.categories = settled([]);
    const { container } = render(<ChatAdminPage />);

    expect(screen.getByText("No channels yet")).toBeInTheDocument();
    expect(screen.getByText("No categories yet")).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("shows its loading state in the nested family", () => {
    reads.channels = empty({
      isPending: true,
      isLoading: true,
      fetchStatus: "fetching",
    });
    const { container } = render(<ChatAdminPage />);

    expect(screen.getByText("Loading channels...")).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("keeps a role-gated channel's permission grid through a failed catalog refresh", () => {
    reads.catalog = { ...settled(CATALOG), isError: true };
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: /^#officers/ }));

    expect(
      screen.queryByText(/Couldn't load the permission catalog/),
    ).toBeNull();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it.each([
    [
      "has failed with nothing loaded",
      { isError: true },
      false,
      /Couldn.t load the permission catalog/,
    ],
    [
      "is loading",
      { isPending: true, isLoading: true, fetchStatus: "fetching" },
      false,
      "Loading permissions…",
    ],
    [
      "can't load offline",
      { isError: true },
      true,
      /Can.t load the permission list while offline/,
    ],
    [
      "is paused offline",
      { isPending: true, fetchStatus: "paused" },
      true,
      /Can.t load the permission list while offline/,
    ],
  ])(
    "says so when a role-gated channel's catalog %s, on the page surface",
    (_, read, offline, text) => {
      mockOffline.value = offline;
      reads.catalog = empty(read);
      const { container } = render(<ChatAdminPage />);
      fireEvent.click(screen.getByRole("button", { name: /^#officers/ }));

      expect(screen.getByText(text)).toBeInTheDocument();
      expect(cardFilledContainers(container)).toEqual([]);
    },
  );

  it("keeps the loaded categories through a failed background read", () => {
    reads.categories = { ...settled(CATEGORIES), isError: true };
    render(<ChatAdminPage />);

    expect(screen.getByText("#general")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load channels")).toBeNull();
    // The categories are what went stale, so the notice says so for them too.
    expect(screen.getByText(CHANNELS_STALE)).toBeInTheDocument();
  });

  it("says what failed when the first read fails, in the nested family", () => {
    reads.channels = empty({ isError: true });
    const { container } = render(<ChatAdminPage />);

    expect(
      screen.getByRole("heading", { name: "Couldn't load channels" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Confirm your chapter access and retry."),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("says the channels are unavailable offline when none are cached", () => {
    mockOffline.value = true;
    reads.channels = empty({ isPending: true, fetchStatus: "paused" });
    const { container } = render(<ChatAdminPage />);
    expect(cardFilledContainers(container)).toEqual([]);

    expect(
      screen.getByRole("heading", { name: "Channels unavailable offline" }),
    ).toBeInTheDocument();
  });
});

describe("ChatAdminPage — a channel's pins", () => {
  it("says a failed read failed, rather than that nothing is pinned", () => {
    reads.pins = empty({ isError: true });
    const { container } = render(<ChatAdminPage />);
    selectExec();
    expect(cardFilledContainers(container)).toEqual([]);

    expect(screen.getByText("Couldn't load pins")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing pinned")).toBeNull();
    // No count when there is no list to count.
    expect(
      screen.getByRole("heading", { level: 4, name: "Pinned messages" }),
    ).toBeInTheDocument();
  });

  it("says the pins are loading, on the page surface", () => {
    reads.pins = empty({
      isPending: true,
      isLoading: true,
      fetchStatus: "fetching",
    });
    const { container } = render(<ChatAdminPage />);
    selectExec();

    expect(screen.getByText("Loading pins...")).toBeInTheDocument();
    expect(screen.queryByText("Nothing pinned")).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("says the pins are unavailable offline when the read failed offline", () => {
    // The API unreachable, or a page restored offline: the read fails rather
    // than pausing, and must not blame the officer's chapter access.
    mockOffline.value = true;
    reads.pins = empty({ isError: true });
    render(<ChatAdminPage />);
    selectExec();

    expect(screen.getByText("Pins unavailable offline")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load pins")).toBeNull();
  });

  it("says the pins are unavailable offline when the read is paused", () => {
    reads.pins = empty({ isPending: true, fetchStatus: "paused" });
    const { container } = render(<ChatAdminPage />);
    selectExec();
    expect(cardFilledContainers(container)).toEqual([]);

    expect(screen.getByText("Pins unavailable offline")).toBeInTheDocument();
    expect(screen.queryByText("Nothing pinned")).toBeNull();
  });

  it("keeps the loaded pins through a failed background read", () => {
    reads.pins = {
      ...settled([
        {
          id: "m-1",
          content: "Dues are due Friday",
          sender_id: null,
          author_name: "Treasurer",
          created_at: "2026-09-30T12:00:00Z",
          pinned_at: "2026-09-30T12:00:00Z",
        },
      ]),
      isError: true,
    };
    render(<ChatAdminPage />);
    selectExec();

    expect(screen.getByText("Dues are due Friday")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load pins")).toBeNull();
    expect(screen.getByText(PINS_STALE)).toBeInTheDocument();
  });

  it("has the pins notice's live region mounted before a refresh fails", () => {
    const pinned = [
      {
        id: "m-1",
        content: "Dues are due Friday",
        sender_id: null,
        author_name: "Treasurer",
        created_at: "2026-09-30T12:00:00Z",
        pinned_at: "2026-09-30T12:00:00Z",
      },
    ];
    reads.pins = settled(pinned);
    const { container, rerender } = render(<ChatAdminPage />);
    selectExec();
    const regions = [...container.querySelectorAll('[role="status"]')];

    reads.pins = { ...settled(pinned), isError: true };
    rerender(<ChatAdminPage />);

    expect(regions).toContain(
      screen.getByText(PINS_STALE).closest('[role="status"]'),
    );
  });

  it("says nothing is pinned when the read succeeded empty", () => {
    const { container } = render(<ChatAdminPage />);
    selectExec();
    expect(cardFilledContainers(container)).toEqual([]);

    expect(screen.getByText("Nothing pinned")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 4, name: "Pinned messages (0)" }),
    ).toBeInTheDocument();
  });
});
