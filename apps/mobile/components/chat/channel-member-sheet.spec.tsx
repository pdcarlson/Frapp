/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ChannelMemberSheet, MemberRows } from "./channel-member-sheet";

/**
 * The mobile member sheet (#3536): who can read the channel, officers first,
 * names in their role color, and the loading and failure states of the two
 * reads it joins.
 */

const state = vi.hoisted(() => ({
  members: {} as {
    data?: { user_id: string; role_rank: number | null }[];
    isPending?: boolean;
    isError?: boolean;
    refetch?: () => void;
  },
  roster: {} as {
    isPending?: boolean;
    isError?: boolean;
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

/** The member rows, by the accessible name each row carries. */
const rowNames = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === ("View" as never) && node.props.accessible)
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
      { user_id: "u-member", role_rank: 5 },
      { user_id: "u-officer", role_rank: 2 },
      { user_id: "u-blank", role_rank: null },
      { user_id: "u-pres", role_rank: 0 },
    ],
  };
  state.roster = {};
  state.channelIds = [];
});

describe("MemberRows", () => {
  it("lists readers officers first, a member with no role last", () => {
    const tree = render(<MemberRows channelId="chan-1" />);

    expect(state.channelIds).toContain("chan-1");
    expect(rowNames(tree)).toEqual([
      "Zed President",
      "Amy Officer",
      "Bob Member",
      // A member who never set a name is listed under the fallback, not dropped.
      expect.stringMatching(/^Member u-bla/),
    ]);
    expect(text(tree)).toContain("4 members");
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
    state.roster = { isError: true, refetch: rosterRefetch };
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

describe("ChannelMemberSheet", () => {
  it("is a tall sheet titled Members over the rows", () => {
    const tree = render(<ChannelMemberSheet channelId="chan-1" />);

    const modal = tree.root.findByType("BottomSheetModal" as never);
    expect(modal.props.snapPoints).toEqual(["100%"]);
    expect(text(tree)).toContain("Members");
    expect(tree.root.findAllByType(MemberRows)).toHaveLength(1);
  });
});
