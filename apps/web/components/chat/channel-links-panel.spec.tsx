import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";

/**
 * A channel's sign-up links in its menu (#5779), which Activity listed for
 * every channel until then. The panel reads Activity's own query; the rows'
 * actions are `activity-link-row.spec.tsx`'s, so the row is stubbed to its
 * contract: which row, whether Remove is offered, and the open callback.
 */
const mockActivity = vi.fn();
const mockMarkRead = vi.fn();
const mockPermissions = vi.fn(() => ({
  data: { permissions: [] as string[] },
}));
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    activityChannelLinks: actual.activityChannelLinks,
    useActivity: () => mockActivity(),
    useActivityUnread: () => ({ markRead: mockMarkRead }),
    useMyPermissions: () => mockPermissions(),
    useNowDate: () => new Date("2026-11-14T15:00:00.000Z"),
  };
});
vi.mock("@/components/activity/activity-link-row", () => ({
  useActivityLinkActions: () => ({}),
  ActivityLinkRow: ({
    row,
    canRemove,
    onOpen,
  }: {
    row: Extract<ActivityRow, { kind: "link" }>;
    canRemove: boolean;
    onOpen?: (row: Extract<ActivityRow, { kind: "link" }>) => void;
  }) => (
    <li>
      <button type="button" onClick={() => onOpen?.(row)}>
        {`link:${row.link.id}:${canRemove ? "officer" : "member"}`}
      </button>
    </li>
  ),
}));

const { CHANNEL_LINKS_EMPTY, ChannelLinksPanel, useChannelLinkCount } =
  await import("./channel-links-panel");

const link = (overrides: Record<string, unknown> = {}) => ({
  id: "l1",
  url: "https://forms.gle/abc",
  host: "forms.gle",
  title: null,
  message_id: "m1",
  thread_root_id: null,
  channel_id: "c1",
  channel_name: "rush",
  channel_type: "PUBLIC",
  posted_by: "olive",
  posted_by_name: "Olive",
  posted_at: "2026-11-10T15:00:00.000Z",
  ...overrides,
});
const loaded = (links: unknown[]) => ({
  data: {
    needs_you: {
      tasks: [],
      task_confirmations: [],
      hours_approvals: [],
      polls: [],
    },
    coming_up: [],
    links,
    made_by_you: { polls: [], tasks: [], events: [] },
    needs_you_count: 0,
    unavailable: [],
  },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPermissions.mockReturnValue({ data: { permissions: [] } });
});

describe("ChannelLinksPanel (#5779)", () => {
  it("lists only this channel's links", () => {
    mockActivity.mockReturnValue(
      loaded([
        link(),
        link({ id: "l2", channel_id: "c2", channel_name: "general" }),
        link({ id: "l3", url: "https://forms.gle/xyz" }),
      ]),
    );
    render(<ChannelLinksPanel channelId="c1" />);

    expect(screen.getAllByRole("button").map((row) => row.textContent)).toEqual(
      ["link:l1:member", "link:l3:member"],
    );
  });

  it("offers Remove only to a channels:manage holder", () => {
    mockPermissions.mockReturnValue({
      data: { permissions: ["channels:manage"] },
    });
    mockActivity.mockReturnValue(loaded([link()]));
    render(<ChannelLinksPanel channelId="c1" />);

    expect(screen.getByText("link:l1:officer")).toBeInTheDocument();
  });

  it("says a channel has none, rather than drawing an empty list", () => {
    mockActivity.mockReturnValue(
      loaded([link({ channel_id: "c2", channel_name: "general" })]),
    );
    render(<ChannelLinksPanel channelId="c1" />);

    expect(screen.getByText(CHANNEL_LINKS_EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says it is loading, and that a failed read failed, never that there are none", () => {
    mockActivity.mockReturnValue({ data: undefined, isPending: true });
    const { unmount } = render(<ChannelLinksPanel channelId="c1" />);
    expect(screen.getByText("Loading links…")).toBeInTheDocument();
    expect(screen.queryByText(CHANNEL_LINKS_EMPTY)).toBeNull();
    unmount();

    mockActivity.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    render(<ChannelLinksPanel channelId="c1" />);
    expect(
      screen.getByText("Couldn't load links. Try again in a moment."),
    ).toBeInTheDocument();
    expect(screen.queryByText(CHANNEL_LINKS_EMPTY)).toBeNull();
  });

  it("clears an unread link's dot when it is opened, and records nothing for a read one", () => {
    mockActivity.mockReturnValue(
      loaded([
        link({ unread: true }),
        link({ id: "l3", url: "https://forms.gle/xyz", unread: false }),
      ]),
    );
    render(<ChannelLinksPanel channelId="c1" />);

    fireEvent.click(screen.getByRole("button", { name: "link:l3:member" }));
    expect(mockMarkRead).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "link:l1:member" }));
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    expect(mockMarkRead).toHaveBeenCalledWith([
      expect.objectContaining({ item_id: "l1" }),
    ]);
  });
});

describe("useChannelLinkCount (#5779)", () => {
  it("counts this channel's links once the read is in, and nothing before", () => {
    mockActivity.mockReturnValue(
      loaded([
        link(),
        link({ id: "l2", channel_id: "c2" }),
        link({ id: "l3" }),
      ]),
    );
    expect(renderHook(() => useChannelLinkCount("c1")).result.current).toBe(2);
    expect(renderHook(() => useChannelLinkCount("c9")).result.current).toBe(0);
    // No channel open: no row, so no count.
    expect(
      renderHook(() => useChannelLinkCount(null)).result.current,
    ).toBeUndefined();

    mockActivity.mockReturnValue({ data: undefined, isPending: true });
    expect(
      renderHook(() => useChannelLinkCount("c1")).result.current,
    ).toBeUndefined();
  });
});
