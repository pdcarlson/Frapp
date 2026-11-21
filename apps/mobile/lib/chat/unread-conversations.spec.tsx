/** @vitest-environment jsdom */
import { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Messages tab's count (#5310), which was the badge on Chat home's
 * Messages door: conversations with anything unread, not messages.
 */

const state = vi.hoisted(() => ({
  channels: [] as unknown[],
  unread: [] as {
    channel_id: string;
    unread_count: number;
    mention_count: number;
  }[],
  threads: new Map<string, { unread_count: number }[]>(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChannels: () => ({ data: state.channels }),
}));
vi.mock("@/lib/chat/unread-first-paint", () => ({
  useShownUnreadCounts: () => ({ data: state.unread, isError: false }),
}));
vi.mock("@/components/chat/channel-thread-rows", () => ({
  useChannelThreads: () => ({ byChannel: state.threads }),
}));

import {
  unreadConversationsSpoken,
  useUnreadConversationCount,
} from "./unread-conversations";

const general = { id: "c-general", name: "general", type: "PUBLIC" };
const dmAlice = { id: "c-dm-alice", name: "dm-a", type: "DM" };
const dmBobHidden = { id: "c-dm-bob", name: "dm-b", type: "DM", hidden: true };
const group = { id: "c-group", name: "group", type: "GROUP_DM" };

function count(): number {
  let seen = -1;
  function Probe() {
    seen = useUnreadConversationCount();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return seen;
}

beforeEach(() => {
  state.channels = [general, dmAlice, dmBobHidden, group];
  state.unread = [];
  state.threads = new Map();
});

describe("useUnreadConversationCount", () => {
  it("is zero with nothing unread", () => {
    expect(count()).toBe(0);
  });

  it("counts conversations with anything unread, not messages, and not channels", () => {
    state.unread = [
      { channel_id: dmAlice.id, unread_count: 4, mention_count: 0 },
      { channel_id: group.id, unread_count: 1, mention_count: 0 },
      // A channel's unread belongs to its own row on Chat home.
      { channel_id: general.id, unread_count: 9, mention_count: 2 },
    ];
    expect(count()).toBe(2);
  });

  it("counts nothing for a hidden conversation", () => {
    state.unread = [
      { channel_id: dmBobHidden.id, unread_count: 3, mention_count: 0 },
    ];
    expect(count()).toBe(0);
  });

  // #5277: thread replies never count toward the conversation's own unread.
  it("counts a group DM whose thread has new replies", () => {
    state.threads = new Map([[group.id, [{ unread_count: 2 }]]]);
    expect(count()).toBe(1);
  });
});

describe("unreadConversationsSpoken", () => {
  it("says the count, singular for one, and nothing at zero", () => {
    expect(unreadConversationsSpoken(0)).toBeNull();
    expect(unreadConversationsSpoken(1)).toBe("1 unread conversation");
    expect(unreadConversationsSpoken(2)).toBe("2 unread conversations");
  });
});
