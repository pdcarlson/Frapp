import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  ChannelMemberList,
  groupChannelMembers,
  type ChannelMemberRow,
} from "./channel-member-list";

const membersQuery = vi.hoisted(() => ({
  value: {} as {
    data?: { user_id: string; role_rank: number | null }[];
    isPending?: boolean;
    isError?: boolean;
    refetch?: () => void;
  },
}));
const presence = vi.hoisted(() => ({
  value: {
    isReady: true,
    statusOf: (() => "offline") as (
      id: string,
    ) => "online" | "idle" | "offline",
  },
}));

const NAMES: Record<string, string> = {
  "u-pres": "Zed President",
  "u-officer": "Amy Officer",
  "u-member": "Bob Member",
  "u-idle": "Cal Idle",
  "u-blank": "",
};
const roster = vi.hoisted(() => ({
  value: {} as { isPending?: boolean; isError?: boolean; refetch?: () => void },
}));

vi.mock("@repo/hooks", async () => ({
  ...(await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks")),
  useChannelMembers: () => ({
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...membersQuery.value,
  }),
  useMemberDisplayNames: () => ({
    byId: NAMES,
    avatarFor: () => null,
    roleColorFor: (id: string) =>
      id === "u-officer" || id === "u-member" ? "#5865F2" : null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...roster.value,
  }),
}));

vi.mock("@/lib/providers/chapter-presence-provider", () => ({
  useChapterPresenceContext: () => presence.value,
}));

function row(overrides: Partial<ChannelMemberRow>): ChannelMemberRow {
  return {
    userId: "u",
    name: "Name",
    avatarUrl: null,
    roleColor: null,
    roleRank: null,
    status: "online",
    ...overrides,
  };
}

describe("groupChannelMembers", () => {
  it("groups online, idle, offline in that order and drops empty groups", () => {
    const groups = groupChannelMembers([
      row({ userId: "a", status: "offline" }),
      row({ userId: "b", status: "online" }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Online", "Offline"]);
  });

  it("sorts by role rank, a member with no role last, then by name", () => {
    const [group] = groupChannelMembers([
      row({ userId: "none", name: "Aaron", roleRank: null }),
      row({ userId: "member", name: "Zoe", roleRank: 5 }),
      row({ userId: "member2", name: "bea", roleRank: 5 }),
      row({ userId: "pres", name: "Yves", roleRank: 0 }),
    ]);
    expect(group?.rows.map((r) => r.userId)).toEqual([
      "pres",
      "member2",
      "member",
      "none",
    ]);
  });

  it("makes one Members group, claiming no one Offline, before presence resolves", () => {
    const groups = groupChannelMembers([
      row({ userId: "a", status: null }),
      row({ userId: "b", status: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Members");
  });

  it("returns no groups for no rows", () => {
    expect(groupChannelMembers([])).toEqual([]);
  });
});

describe("ChannelMemberList", () => {
  beforeEach(() => {
    membersQuery.value = {
      data: [
        { user_id: "u-member", role_rank: 5 },
        { user_id: "u-officer", role_rank: 2 },
        { user_id: "u-pres", role_rank: 0 },
        { user_id: "u-idle", role_rank: null },
        { user_id: "u-blank", role_rank: null },
        { user_id: "u-gone0001", role_rank: 1 },
      ],
    };
    roster.value = {};
    presence.value = {
      isReady: true,
      statusOf: (id) =>
        id === "u-idle"
          ? "idle"
          : id === "u-member" || id === "u-blank"
            ? "offline"
            : "online",
    };
  });

  it("lists readers under their presence group, officers first, names in role color", () => {
    render(<ChannelMemberList channelId="chan-1" />);

    const online = screen.getByRole("list", { name: /Online/ });
    const items = within(online).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Zed President");
    // A reader the roster cannot name is still listed, under the fallback.
    expect(items[1]).toHaveTextContent(/Member u-gon/);
    expect(items[2]).toHaveTextContent("Amy Officer");
    expect(screen.getByText("Amy Officer")).toHaveStyle({ color: "#5865F2" });
    expect(screen.getByRole("list", { name: /Idle/ })).toHaveTextContent(
      "Cal Idle",
    );
  });

  it("lists a member who never set a name, and dims offline rows without losing contrast", () => {
    render(<ChannelMemberList channelId="chan-1" />);

    const offline = screen.getByRole("list", { name: /Offline/ });
    const [colored, blank] = within(offline).getAllByRole("listitem");
    // A role-colored offline name keeps its full color: only the avatar fades.
    const coloredName = within(colored!).getByText("Bob Member");
    expect(coloredName).toHaveStyle({ color: "#5865F2" });
    expect(coloredName.className).not.toMatch(/opacity/);
    expect(colored!.querySelector("[aria-hidden='true']")?.className).toMatch(
      /opacity-50/,
    );
    // An empty display name falls back to the id label, muted while offline.
    expect(within(blank!).getByText(/^Member u-bla/)).toHaveClass(
      "text-muted-foreground",
    );
  });

  it("holds the skeleton until the roster has the names", () => {
    roster.value = { isPending: true };
    render(<ChannelMemberList channelId="chan-1" />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("holds the skeleton without a channel, or while not enabled", () => {
    const { rerender } = render(<ChannelMemberList channelId={null} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    rerender(<ChannelMemberList channelId="chan-1" enabled={false} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("offers a retry when the read fails", () => {
    const refetch = vi.fn();
    membersQuery.value = { isError: true, refetch };
    render(<ChannelMemberList channelId="chan-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("offers a retry that reruns the roster when the names fail", () => {
    const refetch = vi.fn();
    roster.value = { isError: true, refetch };
    render(<ChannelMemberList channelId="chan-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});
