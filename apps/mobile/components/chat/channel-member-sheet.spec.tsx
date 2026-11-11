/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ChannelMemberSheet, MemberRows } from "./channel-member-sheet";
import { memberAvatarHue, memberAvatarTint } from "@repo/hooks";
import { MemberAvatar } from "@/components/member-avatar";
import {
  PRESENCE_NOT_READY,
  setChapterPresence,
} from "@/lib/presence/presence-store";
import type { PresenceStatus } from "@repo/hooks/presence-status";

/**
 * The mobile member sheet (#3536): who can read the channel, officers first,
 * names in their role color, and the loading and failure states of the two
 * reads it joins.
 */

const state = vi.hoisted(() => ({
  members: {} as {
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
  roster: {} as {
    isPending?: boolean;
    isError?: boolean;
    hasData?: boolean;
    isFetching?: boolean;
    refetch?: () => void;
  },
  channelIds: [] as unknown[],
}));

const NAMES: Record<string, string> = {
  "u-pres": "Zed President",
  "u-officer": "Amy Officer",
  "u-member": "Bob Member",
  "u-blank": "",
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChannelMembers: (channelId: unknown) => {
    state.channelIds.push(channelId);
    return {
      data: undefined,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
      ...state.members,
    };
  },
  useMemberDisplayNames: () => ({
    byId: NAMES,
    nameFor: (id: string) => NAMES[id] ?? null,
    avatarFor: () => null,
    roleColorFor: (id: string) => (id === "u-officer" ? "#5865F2" : null),
    isPending: false,
    isError: false,
    hasData: true,
    isFetching: false,
    refetch: vi.fn(),
    ...state.roster,
  }),
}));

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

/** The member rows (or the skeleton), by the accessible name each carries. */
const rowNames = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        (node.type === ("View" as never) && node.props.accessible) ||
        // A row is a Pressable, which opens that member's profile.
        (typeof node.props.accessibilityLabel === "string" &&
          typeof node.props.onPress === "function"),
    )
    .map((node) => node.props.accessibilityLabel as string);

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === ("Text" as never))
    .flatMap((node) => node.props.children)
    .filter((child) => typeof child === "string")
    .join(" | ");

beforeEach(() => {
  state.members = {
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
      { user_id: "u-blank", role_rank: null, role_id: null, role_name: null },
      {
        user_id: "u-pres",
        role_rank: 0,
        role_id: "r-pres",
        role_name: "President",
      },
    ],
  };
  state.roster = {};
  state.channelIds = [];
  setChapterPresence(PRESENCE_NOT_READY);
});

describe("MemberRows", () => {
  it("groups readers under their highest role, a member with no role last", () => {
    const tree = render(<MemberRows channelId="chan-1" />);

    expect(state.channelIds).toContain("chan-1");
    expect(rowNames(tree)).toEqual([
      "Zed President",
      "Amy Officer",
      "Bob Member",
      // A member who never set a name is listed under the fallback, not dropped.
      expect.stringMatching(/^Member u-bla/),
    ]);
    expect(text(tree)).toMatch(
      /President 1 .*Treasurer 1 .*Member 1 .*No role 1/,
    );
    // Four readers need no search field.
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Search members",
      ),
    ).toHaveLength(0);
  });

  it("searches by name past 12 readers", () => {
    state.members = {
      data: Array.from({ length: 13 }, (_, index) => ({
        user_id:
          index === 0 ? "u-pres" : `u-x${String(index).padStart(6, "0")}`,
        role_rank: 5,
        role_id: "r-mem",
        role_name: "Member",
      })),
    };
    const tree = render(<MemberRows channelId="chan-1" />);
    const search = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Search members" &&
        typeof node.props.onChangeText === "function",
    );
    expect(search.props.placeholder).toBe("Search 13 members");
    act(() => search.props.onChangeText("zed"));
    expect(rowNames(tree)).toEqual(["Zed President"]);
    act(() => search.props.onChangeText("nobody"));
    expect(text(tree)).toContain("No one named \u201cnobody\u201d");
  });

  it("paints a name in its role color, and the rest in the foreground", () => {
    const tree = render(<MemberRows channelId="chan-1" />);
    const nameStyle = (name: string) =>
      tree.root
        .find(
          (node) =>
            node.type === ("Text" as never) && node.props.children === name,
        )
        .props.style.flat()
        .filter(Boolean)
        .reduce((all: object, style: object) => ({ ...all, ...style }), {});

    expect(nameStyle("Amy Officer").color).toBe("#5865F2");
    expect(nameStyle("Bob Member").color).not.toBe("#5865F2");
  });

  it("tints each row's initials the way that member's name resolves (#3860)", () => {
    const tree = render(<MemberRows channelId="chan-1" />);
    const avatars = tree.root.findAllByType(MemberAvatar);
    expect(avatars.length).toBeGreaterThan(0);
    for (const avatar of avatars) {
      expect(avatar.props.tint).toBeTruthy();
    }
    expect(avatars.map((a) => a.props.tint)).toContainEqual(
      memberAvatarTint(memberAvatarHue("u-officer", "#5865F2")),
    );
  });

  it("holds the skeleton until the roster has the names", () => {
    state.roster = { isPending: true };
    const tree = render(<MemberRows channelId="chan-1" />);
    expect(rowNames(tree)).toEqual(["Loading members"]);
    expect(text(tree)).not.toContain("members");
  });

  it("holds the skeleton without a channel", () => {
    const tree = render(<MemberRows channelId={null} />);
    expect(rowNames(tree)).toEqual(["Loading members"]);
  });

  it("offers a retry that reruns whichever read failed", () => {
    const membersRefetch = vi.fn();
    const rosterRefetch = vi.fn();
    state.members = { isError: true, refetch: membersRefetch };
    state.roster = { isError: true, hasData: false, refetch: rosterRefetch };
    const tree = render(<MemberRows channelId="chan-1" />);

    expect(text(tree)).toContain("Couldn't load members");
    act(() =>
      tree.root
        .find(
          (node) =>
            node.type === ("Pressable" as never) &&
            node.props.accessibilityLabel === "Try again",
        )
        .props.onPress(),
    );
    expect(membersRefetch).toHaveBeenCalledTimes(1);
    expect(rosterRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("MemberRows, presence (#3917)", () => {
  const STATUS: Record<string, PresenceStatus> = {
    "u-pres": "online",
    "u-officer": "dnd",
    "u-member": "idle",
  };
  const ready = () =>
    setChapterPresence({
      statusOf: (id) => STATUS[id] ?? "offline",
      lineOf: (id) => (id === "u-officer" ? "Counting dues" : null),
      isReady: true,
    });
  const dots = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(
        (node) =>
          typeof node.props.testID === "string" &&
          node.props.testID.startsWith("member-presence-") &&
          node.type === ("View" as never),
      )
      .map((node) => node.props.testID as string);

  it("draws no dot, and claims no Offline, before presence has synced", () => {
    const tree = render(<MemberRows channelId="chan-1" />);
    expect(dots(tree)).toEqual([]);
    expect(rowNames(tree)[0]).toBe("Zed President");
  });

  it("draws each member's dot and names it, with the custom line under the name", () => {
    ready();
    const tree = render(<MemberRows channelId="chan-1" />);
    expect(dots(tree)).toEqual([
      "member-presence-online",
      "member-presence-dnd",
      "member-presence-idle",
      "member-presence-offline",
    ]);
    expect(rowNames(tree)).toEqual([
      "Zed President, Online",
      "Amy Officer, Do Not Disturb",
      "Bob Member, Idle",
      expect.stringMatching(/^Member u-bla.*, Offline$/),
    ]);
    expect(text(tree)).toContain("Counting dues");
  });

  it("follows presence as it changes, without reordering the rows", () => {
    const tree = render(<MemberRows channelId="chan-1" />);
    act(() => ready());
    expect(rowNames(tree)[0]).toBe("Zed President, Online");
    act(() => setChapterPresence(PRESENCE_NOT_READY));
    expect(dots(tree)).toEqual([]);
  });
});

describe("MemberRows, one read failing", () => {
  const retry = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        (node.props.accessibilityLabel === "Try again" ||
          node.props.accessibilityLabel === "Retrying"),
    );

  it("fails on the roster alone, and Retry reruns only the roster", () => {
    const membersRefetch = vi.fn();
    const rosterRefetch = vi.fn();
    state.members = { ...state.members, refetch: membersRefetch };
    state.roster = { isError: true, hasData: false, refetch: rosterRefetch };
    const tree = render(<MemberRows channelId="chan-1" />);

    expect(text(tree)).toContain("Couldn't load members");
    act(() => retry(tree).props.onPress());
    expect(rosterRefetch).toHaveBeenCalledTimes(1);
    expect(membersRefetch).not.toHaveBeenCalled();
  });

  it("fails on the members read alone, and Retry reruns only that", () => {
    const membersRefetch = vi.fn();
    const rosterRefetch = vi.fn();
    state.members = { isError: true, refetch: membersRefetch };
    state.roster = { refetch: rosterRefetch };
    const tree = render(<MemberRows channelId="chan-1" />);

    act(() => retry(tree).props.onPress());
    expect(membersRefetch).toHaveBeenCalledTimes(1);
    expect(rosterRefetch).not.toHaveBeenCalled();
  });

  it("is busy while the roster retry is in flight", () => {
    state.roster = { isError: true, hasData: false, isFetching: true };
    const tree = render(<MemberRows channelId="chan-1" />);
    expect(retry(tree).props.disabled).toBe(true);
  });

  it("keeps a list it can still draw through a failed background refetch", () => {
    state.members = { ...state.members, isError: true };
    state.roster = { isError: true, hasData: true };
    const tree = render(<MemberRows channelId="chan-1" />);

    expect(text(tree)).not.toContain("Couldn't load members");
    expect(rowNames(tree)).toHaveLength(4);
  });
});

describe("ChannelMemberSheet", () => {
  it("is a tall sheet titled Members over the rows", () => {
    const tree = render(<ChannelMemberSheet channelId="chan-1" />);

    const modal = tree.root.findByType("BottomSheetModal" as never);
    expect(modal.props.snapPoints).toEqual(["100%"]);
    expect(text(tree)).toContain("Members");
    expect(tree.root.findAllByType(MemberRows)).toHaveLength(1);
  });
});
