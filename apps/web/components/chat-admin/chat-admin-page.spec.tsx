import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AUDIT_LOG_SETTINGS_NOTE } from "@repo/chat-core/audit-log-copy";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { denseListClassName } from "@/components/shared/table-controls";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { networkMock } from "@/tests/network";

/*
 * Chat Admin's channel structure (#2500): flush on the page surface, its
 * states from the nested family, a background read that fails keeps what is
 * already loaded, and the create panel tells the three types apart truthfully.
 *
 * The report queue below it has its own spec (`chat-reports-card.spec.tsx`)
 * and is stubbed here; so is the screen-level `<Can>`, whose fallbacks
 * `can-fallback.spec.tsx` pins.
 */

const {
  mockOffline,
  reads,
  updateChannel,
  mockCreateChannel,
  mockUpdateCategory,
  router,
} = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  mockCreateChannel: vi.fn(),
  mockUpdateCategory: vi.fn(),
  mockOffline: { value: false },
  updateChannel: {
    mutateAsync: (() => Promise.resolve()) as (
      ...args: unknown[]
    ) => Promise<unknown>,
  },
  reads: {
    channels: {} as Record<string, unknown>,
    categories: {} as Record<string, unknown>,
    pins: {} as Record<string, unknown>,
    accessOptions: {} as Record<string, unknown>,
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    resolveAuthorLabel: actual.resolveAuthorLabel,
    // Chat backgrounds (#3973): the default card is decoration on this page.
    errorCopy: actual.errorCopy,
    useChapterChatBackground: () => ({ data: undefined }),
    useSetChapterChatBackground: () => ({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    }),
    useCurrentChapter: () => ({ data: undefined }),
    useChannels: () => reads.channels,
    useCategories: () => reads.categories,
    usePinnedMessages: () => reads.pins,
    useChannelAccessOptions: () => reads.accessOptions,
    useRoles: () => ({ data: [] }),
    useMemberDisplayNames: () => ({ nameFor: () => null }),
    useCreateChannel: () => ({
      mutateAsync: mockCreateChannel,
      isPending: false,
    }),
    useUpdateChannel: () => ({
      mutateAsync: (...args: unknown[]) => updateChannel.mutateAsync(...args),
      isPending: false,
    }),
    useDeleteChannel: mutation,
    useCreateCategory: mutation,
    useUpdateCategory: () => ({
      mutateAsync: mockUpdateCategory,
      isPending: false,
    }),
    useDeleteCategory: mutation,
    useUnpinMessage: mutation,
  };
});

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./chat-reports-card", () => ({
  ChatReportsCard: ({ channelId }: { channelId?: string }) => (
    <div data-testid="report-queue" data-channel={channelId ?? "chapter"} />
  ),
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { ChatAdminPage } = await import("./chat-admin-page");

const EXEC_TIER = "tier:00000000-0000-4000-8000-000000000001";
const BROTHER_ROLE = "role:00000000-0000-4000-8000-000000000002";
const channel = (
  id: string,
  name: string,
  type: "PUBLIC" | "PRIVATE" | "ROLE_GATED",
) => ({
  id,
  name,
  description: null,
  type,
  who_can_see: null,
  who_can_post: null,
  category_id: "cat-1",
  is_read_only: false,
  default_notification_level: null,
});

const CHANNELS = [
  channel("ch-1", "general", "PUBLIC"),
  channel("ch-2", "exec", "PRIVATE"),
  {
    ...channel("ch-3", "officers", "ROLE_GATED"),
    who_can_see: [EXEC_TIER],
  },
];
const ACCESS_OPTIONS = [
  {
    entry: EXEC_TIER,
    kind: "tier",
    id: "00000000-0000-4000-8000-000000000001",
    name: "Executive board",
    color: null,
    tier_id: null,
    user_ids: ["u-1", "u-2"],
  },
  {
    entry: BROTHER_ROLE,
    kind: "role",
    id: "00000000-0000-4000-8000-000000000002",
    name: "Brother",
    color: "#336699",
    tier_id: null,
    user_ids: ["u-2", "u-3", "u-4"],
  },
];
const CATEGORIES = [{ id: "cat-1", name: "Chapter", display_order: 0 }];

function settled(data: unknown) {
  return {
    data,
    isPending: false,
    isLoading: false,
    isSuccess: true,
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

/** #exec's own settings page: `?channel=ch-2`. */
const exec = () => <ChatAdminPage initialChannelId="ch-2" />;

beforeEach(() => {
  vi.clearAllMocks();
  mockOffline.value = false;
  reads.channels = settled(CHANNELS);
  reads.categories = settled(CATEGORIES);
  reads.pins = settled([]);
  reads.accessOptions = settled(ACCESS_OPTIONS);
});

describe("ChatAdminPage — on the page surface (#2500)", () => {
  it("draws Channels and Categories as labelled sections, with no wrapper card and no narration", () => {
    const { container } = render(<ChatAdminPage />);

    expect(
      within(screen.getByRole("region", { name: "Channels" })).getByRole(
        "button",
        { name: "New channel" },
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
    const { container } = render(exec());
    expect(cardFilledContainers(container)).toEqual([]);

    const pane = screen.getByRole("region", { name: "#exec" });
    expect(
      within(pane).getByRole("heading", { level: 2, name: "#exec" }),
    ).toBeInTheDocument();
    expect(within(pane).getByText("Private")).toBeInTheDocument();
  });
});

// Paul, 2026-11-11: "scope the chat admin panel to whatever channel you're
// editing", reports at the bottom, and no list of every channel.
describe("ChatAdminPage — scoped to the channel being edited", () => {
  it("lists no channels on either page: the chat rail is the list", () => {
    render(<ChatAdminPage />);
    expect(screen.queryByText("#general")).toBeNull();
    expect(screen.queryByRole("button", { name: /^#/ })).toBeNull();
  });

  it("shows only that channel on a channel's page: no other channel, no categories, no chapter background", () => {
    render(exec());

    expect(screen.getByRole("heading", { name: "#exec" })).toBeInTheDocument();
    expect(screen.queryByText("#general")).toBeNull();
    expect(screen.queryByRole("region", { name: "Categories" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New channel" })).toBeNull();
    // The way back to the Chat page of Chapter settings (#3837).
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute(
      "href",
      "/settings?tab=chat",
    );
  });

  it("puts that channel's settings, then its pins, then its own reports last", () => {
    render(exec());

    const settings = screen.getByLabelText("Name");
    const pins = screen.getByRole("heading", { name: /^Pinned messages/ });
    const queue = screen.getByTestId("report-queue");
    expect(queue).toHaveAttribute("data-channel", "ch-2");
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(settings, pins)).toBe(true);
    expect(follows(pins, queue)).toBe(true);
  });

  it("puts the whole chapter's report queue last on the chapter's page", () => {
    render(<ChatAdminPage />);

    const queue = screen.getByTestId("report-queue");
    expect(queue).toHaveAttribute("data-channel", "chapter");
    const categories = screen.getByRole("region", { name: "Categories" });
    expect(
      categories.compareDocumentPosition(queue) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers Delete channel on the channel's own page", () => {
    render(<ChatAdminPage initialChannelId="ch-1" />);
    expect(
      screen.getByRole("button", { name: "Delete channel" }),
    ).toBeInTheDocument();
  });
});

describe("ChatAdminPage — row heights", () => {
  // The 44px floor for a category row. Padding on it puts 8px on top.
  it("lets the controls set the row height, with no padding around them", () => {
    render(<ChatAdminPage />);

    const item = within(screen.getByRole("region", { name: "Categories" }))
      .getByText("Chapter")
      .closest("li") as HTMLElement;
    const categoryRow = item.firstElementChild as HTMLElement;
    expect(categoryRow.className).toContain("min-h-11");
    expect(item.className).not.toMatch(/\bpy-/);
    expect(categoryRow.className).not.toMatch(/\bpy-/);

    // The row has no padding or border of its own, so the list's dividers
    // are what separate the rows.
    expect((item.closest("ul") as HTMLElement).className).toContain(
      denseListClassName,
    );
  });
});

describe("ChatAdminPage — the create panel", () => {
  it("says a private channel is for the people added, and that the type is final", () => {
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));

    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByRole("switch", { name: "Private channel" }),
    ).not.toBeChecked();
    expect(dialog.getByText(/Only people you add can see it/)).toBeVisible();
    expect(
      dialog.getByText(/type can.t be changed after it.s created/),
    ).toBeInTheDocument();
    expect(dialog.queryByText(/visible to every member/)).toBeNull();
    // No read-only switch or permission grid: the two lists replace them.
    expect(dialog.queryByText(/^Read-only/)).toBeNull();
    expect(dialog.queryAllByRole("checkbox")).toEqual([]);
  });

  it("creates a private channel with no lists", async () => {
    mockCreateChannel.mockResolvedValue({});
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "exec" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Private channel" }));
    expect(screen.queryByRole("group", { name: "Who can see" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() => expect(mockCreateChannel).toHaveBeenCalledTimes(1));
    const body = mockCreateChannel.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(body.type).toBe("PRIVATE");
    expect(body).not.toHaveProperty("who_can_see");
  });

  it("creates a channel only the chosen tier can see", async () => {
    mockCreateChannel.mockResolvedValue({});
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "exec-board" },
    });
    const see = screen.getByRole("group", { name: "Who can see" });
    fireEvent.click(within(see).getByRole("radio", { name: "Chosen roles" }));
    // Nothing chosen yet: the panel won't create a channel nobody can see.
    expect(
      screen.getByRole("button", { name: "Create channel" }),
    ).toBeDisabled();
    fireEvent.click(
      within(see).getByRole("button", { name: "Add to who can see" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /Executive board/ }),
    );
    expect(
      within(see).getByText("Reaches 2 people.", { exact: false }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() =>
      expect(mockCreateChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "exec-board",
          type: "ROLE_GATED",
          who_can_see: [EXEC_TIER],
          who_can_post: null,
        }),
      ),
    );
  });

  // The footer's Create sits outside the form and submits it through `form=`.
  it("creates the channel from the footer's Create button", async () => {
    mockCreateChannel.mockResolvedValue({});
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "rush-planning" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() =>
      expect(mockCreateChannel).toHaveBeenCalledWith(
        expect.objectContaining({ name: "rush-planning", type: "PUBLIC" }),
      ),
    );
    // Lists untouched: the server copies the category's.
    expect(mockCreateChannel.mock.calls[0]?.[0]).not.toHaveProperty(
      "who_can_see",
    );
  });

  it("creates the channel unlocked by default, and Always formal when switched on (#3787)", async () => {
    mockCreateChannel.mockResolvedValue({});
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "announcements-2" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("switch", {
        name: /Always formal/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() =>
      expect(mockCreateChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "announcements-2",
          display_locked: true,
        }),
      ),
    );
  });

  it("sends Always formal off when the switch is left alone (#3787)", async () => {
    mockCreateChannel.mockResolvedValue({});
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "random-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() =>
      expect(mockCreateChannel).toHaveBeenCalledWith(
        expect.objectContaining({ display_locked: false }),
      ),
    );
  });

  // Cancel sets state directly, and Radix fires no `onOpenChange` for that, so
  // it has to drop the draft itself the way the X and Escape do.
  it("drops the draft on Cancel, so the next New channel starts empty", () => {
    render(<ChatAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "rush-planning" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));

    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});

describe("ChatAdminPage — the create panel docked (#4593)", () => {
  it("opens in place of Chat admin beside chat, and the arrow drops the draft", () => {
    render(
      <div data-tool-column="">
        <div data-tool-page="">
          <ChatAdminPage />
        </div>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const region = screen.getByRole("region", { name: "Create a channel" });
    expect(region.parentElement).toHaveAttribute("data-tool-column");
    fireEvent.change(within(region).getByLabelText("Name"), {
      target: { value: "rush-planning" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to chat admin" }));
    expect(
      screen.queryByRole("region", { name: "Create a channel" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});

describe("ChatAdminPage — the channel structure's states", () => {
  it("keeps the loaded channels through a failed background read, and says they are the last that loaded", () => {
    reads.channels = { ...settled(CHANNELS), isError: true };
    render(<ChatAdminPage initialChannelId="ch-1" />);

    expect(
      screen.getByRole("heading", { name: "#general" }),
    ).toBeInTheDocument();
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

    expect(
      screen.getByText("No channels yet. Create the first one above."),
    ).toBeInTheDocument();
    expect(screen.getByText(/^No categories yet\./)).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("shows its loading state in the nested family", () => {
    reads.channels = empty({
      isPending: true,
      isLoading: true,
      fetchStatus: "fetching",
    });
    const { container } = render(<ChatAdminPage />);

    expect(screen.getByText("Loading channels")).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("keeps a chosen list's names through a failed options refresh", () => {
    reads.accessOptions = { ...settled(ACCESS_OPTIONS), isError: true };
    render(<ChatAdminPage initialChannelId="ch-3" />);

    const see = screen.getByRole("group", { name: "Who can see" });
    expect(within(see).getByText("Executive board")).toBeInTheDocument();
    expect(within(see).getByText(/Reaches 2 people/)).toBeInTheDocument();
  });

  it("still shows a chosen list when the options never loaded", () => {
    reads.accessOptions = empty({ isError: true });
    render(<ChatAdminPage initialChannelId="ch-3" />);

    const see = screen.getByRole("group", { name: "Who can see" });
    expect(within(see).getByText("Unavailable")).toBeInTheDocument();
    // The rest of the form still saves.
    expect(screen.getByRole("button", { name: "Save channel" })).toBeEnabled();
  });

  it("keeps the loaded categories through a failed background read", () => {
    reads.categories = { ...settled(CATEGORIES), isError: true };
    render(<ChatAdminPage />);

    expect(screen.getByText("Chapter")).toBeInTheDocument();
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
      screen.getByText(
        "Couldn't reach Frapp. Check your connection and try again.",
      ),
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
    const { container } = render(exec());
    expect(cardFilledContainers(container)).toEqual([]);

    expect(screen.getByText("Couldn't load pins")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing pinned")).toBeNull();
    // No count when there is no list to count.
    expect(
      screen.getByRole("heading", { level: 3, name: "Pinned messages" }),
    ).toBeInTheDocument();
  });

  it("says the pins are loading, on the page surface", () => {
    reads.pins = empty({
      isPending: true,
      isLoading: true,
      fetchStatus: "fetching",
    });
    const { container } = render(exec());

    expect(screen.getByText("Loading pins...")).toBeInTheDocument();
    expect(screen.queryByText("Nothing pinned")).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("says the pins are unavailable offline when the read failed offline", () => {
    // The API unreachable, or a page restored offline: the read fails rather
    // than pausing, and must say offline, not show a load error.
    mockOffline.value = true;
    reads.pins = empty({ isError: true });
    render(exec());

    expect(screen.getByText("Pins unavailable offline")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load pins")).toBeNull();
  });

  it("says the pins are unavailable offline when the read is paused", () => {
    reads.pins = empty({ isPending: true, fetchStatus: "paused" });
    const { container } = render(exec());
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
    render(exec());

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
    const { container, rerender } = render(exec());
    const regions = [...container.querySelectorAll('[role="status"]')];

    reads.pins = { ...settled(pinned), isError: true };
    rerender(exec());

    expect(regions).toContain(
      screen.getByText(PINS_STALE).closest('[role="status"]'),
    );
  });

  it("says nothing is pinned when the read succeeded empty", () => {
    const { container } = render(exec());
    expect(cardFilledContainers(container)).toEqual([]);

    expect(
      screen.getByText("Nothing pinned. Pin a message from the channel."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Pinned messages (0)" }),
    ).toBeInTheDocument();
  });
});

describe("ChatAdminPage — saving a channel", () => {
  it("leaves a never-set description alone when another field is saved", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).not.toHaveProperty("description");
  });

  it("leaves the chapter default alone when another field is saved", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).not.toHaveProperty("is_default");
  });

  it("makes the channel the chapter default from its switch", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-1" />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Chapter default channel" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).toMatchObject({ is_default: true });
  });

  it("sends the description once the officer has typed one", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-1" />);

    fireEvent.change(document.getElementById("ca-description")!, {
      target: { value: "  The whole chapter.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).toMatchObject({ description: "The whole chapter." });
  });

  it("sends an empty description when the officer clears one", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    reads.channels = settled([
      { ...CHANNELS[0], description: "Old words." },
      ...CHANNELS.slice(1),
    ]);
    render(<ChatAdminPage initialChannelId="ch-1" />);

    fireEvent.change(document.getElementById("ca-description")!, {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).toMatchObject({ description: "" });
  });

  it("doesn't send an untouched draft over a description that arrived on refetch", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    const { rerender } = render(<ChatAdminPage initialChannelId="ch-1" />);

    reads.channels = settled([
      { ...CHANNELS[0], description: "The whole chapter." },
      ...CHANNELS.slice(1),
    ]);
    rerender(<ChatAdminPage initialChannelId="ch-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).not.toHaveProperty("description");
  });

  it("keeps the current default when another field of it is saved, and badges it", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    reads.channels = settled([
      { ...CHANNELS[0], is_default: true },
      ...CHANNELS.slice(1),
    ]);
    render(<ChatAdminPage initialChannelId="ch-1" />);

    expect(
      screen.getByRole("switch", { name: "Chapter default channel" }),
    ).toBeChecked();
    expect(
      within(screen.getByRole("region", { name: "#general" })).getByText(
        "Default",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).not.toHaveProperty("is_default");
  });

  it("doesn't move the default back when another officer moved it under an untouched switch", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    reads.channels = settled([
      { ...CHANNELS[0], is_default: true },
      ...CHANNELS.slice(1),
    ]);
    const { rerender } = render(<ChatAdminPage initialChannelId="ch-1" />);

    // Another officer made #exec the default; the list refetched.
    reads.channels = settled([
      CHANNELS[0],
      { ...CHANNELS[1], is_default: true },
      CHANNELS[2],
    ]);
    rerender(<ChatAdminPage initialChannelId="ch-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body,
    ).not.toHaveProperty("is_default");
  });
});

describe("ChatAdminPage — opened from a channel start", () => {
  it("selects ?channel= and puts the cursor in its description", () => {
    render(<ChatAdminPage initialChannelId="ch-2" />);

    expect(screen.getByRole("heading", { name: "#exec" })).toBeInTheDocument();
    expect(document.activeElement).toBe(
      document.getElementById("ca-description"),
    );
  });

  it("waits for the channel list when the page is opened cold", () => {
    reads.channels = {
      data: undefined,
      isPending: true,
      isLoading: true,
      isSuccess: false,
      isError: false,
      fetchStatus: "fetching",
      refetch: vi.fn(),
    };
    const { rerender } = render(<ChatAdminPage initialChannelId="ch-2" />);

    reads.channels = settled(CHANNELS);
    rerender(<ChatAdminPage initialChannelId="ch-2" />);

    expect(screen.getByRole("heading", { name: "#exec" })).toBeInTheDocument();
    expect(document.activeElement).toBe(
      document.getElementById("ca-description"),
    );
  });

  it("says the channel is gone when it was deleted under the page, and links back", () => {
    const { rerender } = render(<ChatAdminPage initialChannelId="ch-2" />);

    reads.channels = settled(CHANNELS.filter((c) => c.id !== "ch-2"));
    rerender(<ChatAdminPage initialChannelId="ch-2" />);

    expect(screen.getByText(/isn.t here anymore/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(
      screen.getByRole("link", { name: "All chat settings" }),
    ).toHaveAttribute("href", "/settings?tab=chat");
  });

  it("says so for a channel id it doesn't know", () => {
    render(<ChatAdminPage initialChannelId="nope" />);

    expect(screen.getByText(/isn.t here anymore/)).toBeInTheDocument();
  });
});

// #3909: only Frapp posts in the audit log, and the server refuses renaming
// it or switching its read-only off, so the form locks both.
describe("ChatAdminPage — the audit log", () => {
  beforeEach(() => {
    reads.channels = settled([
      ...CHANNELS,
      {
        ...channel("ch-4", "chapter-audit", "PUBLIC"),
        is_read_only: true,
        is_audit_log: true,
      },
    ]);
  });

  it("locks its name and shows the audit log line in place of the read-only switch", () => {
    render(<ChatAdminPage initialChannelId="ch-4" />);

    const pane = screen.getByRole("region", { name: "#chapter-audit" });
    expect(within(pane).getByLabelText("Name")).toBeDisabled();
    expect(within(pane).getByText(AUDIT_LOG_SETTINGS_NOTE)).toBeInTheDocument();
    expect(within(pane).queryByText(/^Read-only/)).toBeNull();
    // The server refuses deleting it, so no Delete control is offered.
    expect(screen.queryByRole("button", { name: "Delete channel" })).toBeNull();
  });

  it("keeps the name and the two lists open on an ordinary channel", () => {
    render(<ChatAdminPage initialChannelId="ch-1" />);

    const pane = screen.getByRole("region", { name: "#general" });
    expect(within(pane).getByLabelText("Name")).toBeEnabled();
    expect(
      within(pane).getByRole("group", { name: "Who can post" }),
    ).toBeInTheDocument();
    expect(within(pane).queryByText(AUDIT_LOG_SETTINGS_NOTE)).toBeNull();
  });

  it("shows the audit log line in place of the lists", () => {
    render(<ChatAdminPage initialChannelId="ch-4" />);
    expect(screen.queryByRole("group", { name: "Who can see" })).toBeNull();
  });

  describe("Leave out of Activity (#3897)", () => {
    const bodyOf = (spy: ReturnType<typeof vi.fn>) =>
      (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
        .body;

    it("shows the channel's setting and sends it only when the officer flips it", async () => {
      const spy = vi.fn(() => Promise.resolve());
      updateChannel.mutateAsync = spy;
      reads.channels = settled([
        { ...CHANNELS[0], activity_excluded: true },
        ...CHANNELS.slice(1),
      ]);
      render(<ChatAdminPage initialChannelId="ch-1" />);

      const toggle = screen.getByRole("switch", {
        name: "Leave out of Activity",
      });
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(bodyOf(spy)).toMatchObject({ activity_excluded: false });
    });

    it("doesn't undo another officer's setting when another field is saved", async () => {
      const spy = vi.fn(() => Promise.resolve());
      updateChannel.mutateAsync = spy;
      const { rerender } = render(<ChatAdminPage initialChannelId="ch-1" />);

      // Another officer left #general out of Activity; the list refetched.
      reads.channels = settled([
        { ...CHANNELS[0], activity_excluded: true },
        ...CHANNELS.slice(1),
      ]);
      rerender(<ChatAdminPage initialChannelId="ch-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      expect(bodyOf(spy)).not.toHaveProperty("activity_excluded");
    });
  });
});

// #3722: who can see and post, two lists, and a channel follows its category
// until changed.
describe("ChatAdminPage — who can see and post", () => {
  const bodyOf = (spy: ReturnType<typeof vi.fn>) =>
    (spy.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0]
      .body;

  it("says a private channel's members decide, with no lists", () => {
    render(exec());
    const pane = screen.getByRole("region", { name: "#exec" });
    expect(
      within(pane).getByText(/Only the people added to this channel/),
    ).toBeInTheDocument();
    expect(
      within(pane).queryByRole("group", { name: "Who can see" }),
    ).toBeNull();
  });

  it("leaves the lists out of a save that didn't change them", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy)).not.toHaveProperty("who_can_see");
    expect(bodyOf(spy)).not.toHaveProperty("match_category_access");
  });

  it("sends only the list the officer changed", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-1" />);
    expect(screen.getByText("Matches Chapter")).toBeInTheDocument();

    const post = screen.getByRole("group", { name: "Who can post" });
    fireEvent.click(within(post).getByRole("radio", { name: "Chosen roles" }));
    expect(screen.getByRole("button", { name: "Save channel" })).toBeDisabled();
    fireEvent.click(
      within(post).getByRole("button", { name: "Add to who can post" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: /Brother/ }));
    expect(screen.getByText("Custom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy)).toMatchObject({ who_can_post: [BROTHER_ROLE] });
    expect(bodyOf(spy)).not.toHaveProperty("who_can_see");
  });

  // Migration 20261111233000 gives a channel nobody but the President could
  // see an empty list, which the form can't build; renaming it still saves.
  it("saves a channel whose list was already empty", async () => {
    reads.channels = settled([
      ...CHANNELS,
      { ...channel("ch-4", "vault", "ROLE_GATED"), who_can_see: [] },
    ]);
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-4" />);

    expect(
      screen.getByRole("button", { name: "Save channel" }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy)).not.toHaveProperty("who_can_see");
  });

  it("forgets Match when the officer picks another category", async () => {
    reads.categories = settled([
      ...CATEGORIES,
      { id: "cat-2", name: "Social", display_order: 1 },
    ]);
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-3" />);

    fireEvent.click(screen.getByRole("button", { name: "Match Chapter" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name: "Social" }));
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy)).toMatchObject({ category_id: "cat-2" });
    expect(bodyOf(spy)).not.toHaveProperty("match_category_access");
  });

  it("opens a read-only private channel to everyone in it", async () => {
    reads.channels = settled([
      channel("ch-1", "general", "PUBLIC"),
      {
        ...channel("ch-2", "exec", "PRIVATE"),
        who_can_post: [EXEC_TIER],
        is_read_only: true,
      },
    ]);
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(exec());

    expect(
      screen.getByText(/of them only Executive board can post/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Let everyone in it post" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy)).toMatchObject({ who_can_post: null });
  });

  it("matches the category again on request", async () => {
    const spy = vi.fn(() => Promise.resolve());
    updateChannel.mutateAsync = spy;
    render(<ChatAdminPage initialChannelId="ch-3" />);

    fireEvent.click(screen.getByRole("button", { name: "Match Chapter" }));
    expect(screen.getByText("Matches Chapter")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(bodyOf(spy)).toMatchObject({ match_category_access: true });
    expect(bodyOf(spy)).not.toHaveProperty("who_can_see");
  });

  it("edits a category's lists and names the channels that follow", async () => {
    mockUpdateCategory.mockResolvedValue({});
    render(<ChatAdminPage />);

    expect(screen.getByText("Everyone can see and post")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Who can see and post in Chapter" }),
    );
    // #general matches the category; #officers is custom; #exec is private.
    expect(
      screen.getByText(/Saving also changes #general/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/One channel has custom access and keeps it/),
    ).toBeInTheDocument();

    const see = screen.getByRole("group", { name: "Who can see" });
    fireEvent.click(within(see).getByRole("radio", { name: "Chosen roles" }));
    fireEvent.click(
      within(see).getByRole("button", { name: "Add to who can see" }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: /Executive board/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));

    await waitFor(() =>
      expect(mockUpdateCategory).toHaveBeenCalledWith({
        id: "cat-1",
        body: { who_can_see: [EXEC_TIER] },
      }),
    );
  });
});
