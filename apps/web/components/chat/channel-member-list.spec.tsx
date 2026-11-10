import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memberAvatarHue } from "@repo/hooks";
import { ChannelMemberList } from "./channel-member-list";

const membersQuery = vi.hoisted(() => ({
  value: {} as {
    data?: {
      user_id: string;
      role_rank: number | null;
      role_id?: string | null;
      role_name?: string | null;
    }[];
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
    ) => "online" | "idle" | "dnd" | "invisible" | "offline",
    lineOf: (() => null) as (id: string) => string | null,
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
  value: {} as {
    isPending?: boolean;
    isError?: boolean;
    hasData?: boolean;
    refetch?: () => void;
  },
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
    hasData: true,
    isFetching: false,
    refetch: vi.fn(),
    ...roster.value,
  }),
}));

vi.mock("@/lib/providers/chapter-presence-provider", () => ({
  useChapterPresenceContext: () => presence.value,
}));

describe("ChannelMemberList", () => {
  beforeEach(() => {
    membersQuery.value = {
      data: [
        {
          user_id: "u-member",
          role_rank: 5,
          role_id: "r-mem",
          role_name: "Member",
        },
        {
          user_id: "u-officer",
          role_rank: 2,
          role_id: "r-off",
          role_name: "Treasurer",
        },
        {
          user_id: "u-pres",
          role_rank: 0,
          role_id: "r-pres",
          role_name: "President",
        },
        { user_id: "u-idle", role_rank: null, role_id: null, role_name: null },
        { user_id: "u-blank", role_rank: null, role_id: null, role_name: null },
        {
          user_id: "u-gone0001",
          role_rank: 5,
          role_id: "r-mem",
          role_name: "Member",
        },
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
      lineOf: (id) => (id === "u-pres" ? "At nationals" : null),
    };
  });

  it("groups readers under their highest role, in role order, names A to Z", () => {
    render(<ChannelMemberList channelId="chan-1" />);

    const groups = screen.getAllByRole("list");
    expect(
      groups.map(
        (list) =>
          list.getAttribute("aria-labelledby") &&
          list.previousSibling?.textContent,
      ),
    ).toEqual(["President1", "Treasurer1", "Member2", "No role2"]);
    const members = within(
      screen.getByRole("list", { name: /^Member/ }),
    ).getAllByRole("listitem");
    expect(members[0]).toHaveTextContent("Bob Member");
    // A reader the roster cannot name is still listed, under the fallback.
    expect(members[1]).toHaveTextContent(/Member u-gon/);
    expect(screen.getByText("Amy Officer")).toHaveStyle({ color: "#5865F2" });
  });

  // #3726: a row opens that member's profile, as on mobile.
  it("opens a member's profile from their row, a keyboard-reachable button", async () => {
    const onOpenProfile = vi.fn();
    render(
      <ChannelMemberList channelId="chan-1" onOpenProfile={onOpenProfile} />,
    );

    const row = within(screen.getByText("Bob Member").closest("li")!).getByRole(
      "button",
    );
    fireEvent.click(row);
    expect(onOpenProfile).toHaveBeenCalledWith("u-member");

    onOpenProfile.mockClear();
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenProfile).toHaveBeenCalledWith("u-member");
  });

  it("tints each row's initials the way that member's name resolves (#3860)", () => {
    const { container } = render(<ChannelMemberList channelId="chan-1" />);
    const tints = [...container.querySelectorAll("[data-avatar-tint]")].map(
      (node) => node.getAttribute("data-avatar-tint"),
    );
    const ids = (membersQuery.value.data ?? []).map(
      (member: { user_id: string }) => member.user_id,
    );
    expect(tints).toHaveLength(ids.length);
    expect(new Set(tints)).toEqual(
      new Set(
        ids.map((id: string) =>
          memberAvatarHue(
            id,
            id === "u-officer" || id === "u-member" ? "#5865F2" : null,
          ),
        ),
      ),
    );
  });

  it("draws plain rows where no profile can open", () => {
    render(<ChannelMemberList channelId="chan-1" />);
    expect(
      within(screen.getByText("Bob Member").closest("li")!).queryByRole(
        "button",
      ),
    ).not.toBeInTheDocument();
  });

  it("does not move a row when presence arrives", () => {
    presence.value = {
      isReady: false,
      statusOf: () => "offline",
      lineOf: () => null,
    };
    const { rerender } = render(<ChannelMemberList channelId="chan-1" />);
    const before = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent);

    presence.value = {
      isReady: true,
      statusOf: (id) => (id === "u-idle" ? "idle" : "online"),
      lineOf: () => null,
    };
    rerender(<ChannelMemberList channelId="chan-1" />);
    const after = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent?.replace(/, (Online|Idle|Offline)$/, ""));
    expect(after).toEqual(before);
  });

  // #3845: the custom line is one muted line under the name, and the row
  // grows from 32 to 40px only when it has one.
  it("shows a member's custom status under their name, growing only that row", () => {
    render(<ChannelMemberList channelId="chan-1" />);
    const line = screen.getByText("At nationals");
    const row = line.closest("li")!;
    expect(row).toHaveTextContent("Zed President");
    expect(row.firstElementChild).toHaveClass("h-10");
    expect(
      screen.getByText("Bob Member").closest("li")!.firstElementChild,
    ).toHaveClass("h-8");
  });

  // The viewer's own Invisible row reads as the chapter sees it: dimmed.
  it("dims the viewer's own row while they are invisible", () => {
    presence.value = {
      isReady: true,
      statusOf: (id) => (id === "u-officer" ? "invisible" : "online"),
      lineOf: () => null,
    };
    render(<ChannelMemberList channelId="chan-1" />);
    const row = screen.getByText("Amy Officer").closest("li")!;
    expect(row).toHaveAttribute("data-presence", "invisible");
    expect(row.querySelector("[class*='opacity-50']")).not.toBeNull();
    expect(
      screen.getByText("Bob Member").closest("li")!.querySelector("[class*='opacity-50']"),
    ).toBeNull();
  });

  it("searches by name past 12 readers and says when no one matches", () => {
    membersQuery.value = {
      data: Array.from({ length: 13 }, (_, index) => ({
        user_id:
          index === 0 ? "u-pres" : `u-x${String(index).padStart(6, "0")}`,
        role_rank: 5,
        role_id: "r-mem",
        role_name: "Member",
      })),
    };
    render(<ChannelMemberList channelId="chan-1" />);

    const search = screen.getByRole("searchbox", { name: "Search members" });
    expect(search).toHaveAttribute("placeholder", "Search 13 members");
    fireEvent.change(search, { target: { value: "zed" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Zed President")).toBeTruthy();

    fireEvent.change(search, { target: { value: "nobody" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No one named “nobody”",
    );

    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.getAllByRole("listitem")).toHaveLength(13);
  });

  it("draws no search field for a small channel", () => {
    render(<ChannelMemberList channelId="chan-1" />);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("lists a member who never set a name, and dims offline rows without losing contrast", () => {
    render(<ChannelMemberList channelId="chan-1" />);

    const colored = screen.getByText("Bob Member").closest("li")!;
    const blank = screen.getByText(/^Member u-bla/).closest("li")!;
    // A role-colored offline name keeps its full color: only the avatar fades.
    const coloredName = within(colored).getByText("Bob Member");
    expect(coloredName).toHaveStyle({ color: "#5865F2" });
    expect(coloredName.className).not.toMatch(/opacity/);
    expect(colored.querySelector("[aria-hidden='true']")?.className).toMatch(
      /opacity-50/,
    );
    // An empty display name falls back to the id label, muted while offline.
    expect(within(blank).getByText(/^Member u-bla/)).toHaveClass(
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
    roster.value = { isError: true, hasData: false, refetch };
    render(<ChannelMemberList channelId="chan-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps a list it can still draw through a failed background refetch", () => {
    membersQuery.value = { ...membersQuery.value, isError: true };
    roster.value = { isError: true, hasData: true };
    render(<ChannelMemberList channelId="chan-1" />);

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Amy Officer")).toBeTruthy();
  });

  it("reruns only the read that failed", () => {
    const membersRefetch = vi.fn();
    const rosterRefetch = vi.fn();
    membersQuery.value = { ...membersQuery.value, refetch: membersRefetch };
    roster.value = { isError: true, hasData: false, refetch: rosterRefetch };
    render(<ChannelMemberList channelId="chan-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(rosterRefetch).toHaveBeenCalled();
    expect(membersRefetch).not.toHaveBeenCalled();
  });
});
