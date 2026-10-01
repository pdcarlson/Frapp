import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
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
    usePermissionsCatalog: () => ({
      data: [],
      isPending: false,
      isLoading: false,
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn(),
    }),
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
];
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

const selectExec = () =>
  fireEvent.click(screen.getByRole("button", { name: /^#exec/ }));

beforeEach(() => {
  vi.clearAllMocks();
  mockOffline.value = false;
  reads.channels = settled(CHANNELS);
  reads.categories = settled(CATEGORIES);
  reads.pins = settled([]);
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

  it("shows the channel's type beside the edit heading", () => {
    render(<ChatAdminPage />);
    selectExec();

    const pane = screen.getByRole("region", { name: "Edit #exec" });
    expect(
      within(pane).getByRole("heading", { level: 3, name: "Edit #exec" }),
    ).toBeInTheDocument();
    expect(within(pane).getByText("Private")).toBeInTheDocument();
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
  it("keeps the loaded channels through a failed background read", () => {
    reads.channels = { ...settled(CHANNELS), isError: true };
    render(<ChatAdminPage />);

    expect(screen.getByText("#general")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load channels")).toBeNull();
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
    render(<ChatAdminPage />);

    expect(
      screen.getByRole("heading", { name: "Channels unavailable offline" }),
    ).toBeInTheDocument();
  });
});

describe("ChatAdminPage — a channel's pins", () => {
  it("says a failed read failed, rather than that nothing is pinned", () => {
    reads.pins = empty({ isError: true });
    render(<ChatAdminPage />);
    selectExec();

    expect(screen.getByText(/Couldn't load the pins/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing pinned")).toBeNull();
    // No count when there is no list to count.
    expect(
      screen.getByRole("heading", { level: 4, name: "Pinned messages" }),
    ).toBeInTheDocument();
  });

  it("says the pins are unavailable offline when the read is paused", () => {
    reads.pins = empty({ isPending: true, fetchStatus: "paused" });
    render(<ChatAdminPage />);
    selectExec();

    expect(screen.getByText(/Pins unavailable offline/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing pinned")).toBeNull();
  });

  it("says nothing is pinned when the read succeeded empty", () => {
    render(<ChatAdminPage />);
    selectExec();

    expect(screen.getByText("Nothing pinned")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 4, name: "Pinned messages (0)" }),
    ).toBeInTheDocument();
  });
});
