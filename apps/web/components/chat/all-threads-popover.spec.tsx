import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberThread } from "@repo/hooks";
import { AllThreadsPopover } from "./all-threads-popover";

/**
 * All threads (#4960): the chat header's Threads button and its list. The
 * read is the server's, so this pins what the member sees of it: the unread
 * mark on the button, each state of the list, and that a row opens its
 * thread in its own channel.
 */

const query = vi.hoisted(() => ({
  value: {} as {
    data?: MemberThread[];
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => void;
  },
}));

vi.mock("@repo/hooks", async () => ({
  ...(await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks")),
  useMemberThreads: () => query.value,
}));

const ALICE = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<MemberThread["root"]>) {
  return {
    id: "root-1",
    channel_id: "chan-dues",
    sender_id: ALICE,
    content: "Dues are due Friday",
    is_deleted: false,
    created_at: new Date(2026, 10, 13, 9).toISOString(),
    thread_root_id: null,
    thread_reply_count: 3,
    thread_last_reply_at: new Date(2026, 10, 13, 10).toISOString(),
    ...overrides,
  } as MemberThread["root"];
}

const lastReply = (over: Record<string, unknown> = {}) => ({
  id: "reply-1",
  sender_id: BEN,
  content: "Paid mine",
  kind: "text",
  attachment_count: 0,
  created_at: new Date(2026, 10, 13, 10).toISOString(),
  ...over,
});

function thread(overrides: Partial<MemberThread> = {}): MemberThread {
  return {
    thread_root_id: "root-1",
    channel_id: "chan-dues",
    state: "following",
    last_read_at: null,
    last_reply_at: new Date(2026, 10, 13, 10).toISOString(),
    reply_count: 3,
    unread_count: 2,
    root: message({ thread_last_reply: lastReply() } as never),
    ...overrides,
  };
}

const nameFor = (id: string) =>
  id === ALICE ? "Alice Chen" : id === BEN ? "Ben Ortiz" : null;

function renderPopover(onOpenThread = vi.fn()) {
  render(
    <AllThreadsPopover
      channelNameFor={(id) => (id === "chan-dues" ? "#dues" : null)}
      nameFor={nameFor}
      viewerId={null}
      onOpenThread={onOpenThread}
    />,
  );
  return onOpenThread;
}

beforeEach(() => {
  query.value = {
    data: [thread()],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
});

describe("AllThreadsPopover", () => {
  it("says on the button how many threads have new replies", () => {
    renderPopover();
    expect(
      screen.getByRole("button", { name: "Threads, 1 with new replies" }),
    ).toBeInTheDocument();
  });

  it("names the button plainly when nothing is new", () => {
    query.value.data = [thread({ unread_count: 0 })];
    renderPopover();
    expect(screen.getByRole("button", { name: "Threads" })).toBeInTheDocument();
  });

  it("lists a thread with its channel, parent and latest reply, says what's new, and opens it", async () => {
    const onOpenThread = renderPopover();
    await userEvent.click(screen.getByRole("button", { name: /^Threads/ }));

    expect(screen.getByText("#dues")).toBeInTheDocument();
    expect(screen.getByText("Dues are due Friday")).toBeInTheDocument();
    expect(screen.getByText("Paid mine")).toBeInTheDocument();
    expect(screen.getByText("Ben:")).toBeInTheDocument();
    expect(screen.getByText("3 replies")).toBeInTheDocument();
    // Unread is a dot and a bolder title, never a New badge (components.md).
    expect(screen.queryByText("2 new")).toBeNull();
    const row = screen.getByRole("button", { name: "Thread in #dues, 2 new" });

    await userEvent.click(row);
    expect(onOpenThread).toHaveBeenCalledWith("chan-dues", "root-1");
  });

  it("re-reads the list each time it opens", async () => {
    renderPopover();
    await userEvent.click(screen.getByRole("button", { name: /^Threads/ }));
    expect(query.value.refetch).toHaveBeenCalledTimes(1);
  });

  it("reads a file-only reply and a blocked member's parent as the channel does", async () => {
    query.value.data = [
      thread({
        root: message({
          sender_blocked: true,
          content: "[message from a blocked member]",
          thread_last_reply: lastReply({ content: "", attachment_count: 2 }),
        } as never),
      }),
    ];
    renderPopover();
    await userEvent.click(screen.getByRole("button", { name: /^Threads/ }));
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
    expect(
      screen.getByText("Message from a member you blocked"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Alice Chen/)).toBeNull();
  });

  it("says when there are no threads, rather than drawing an empty list", async () => {
    query.value.data = [];
    renderPopover();
    await userEvent.click(screen.getByRole("button", { name: "Threads" }));
    expect(screen.getByText(/No threads yet/)).toBeInTheDocument();
  });

  it("offers a retry when the read failed, not the empty copy", async () => {
    query.value = { ...query.value, data: undefined, isError: true };
    renderPopover();
    await userEvent.click(screen.getByRole("button", { name: "Threads" }));
    expect(screen.getByText("Couldn't load your threads.")).toBeInTheDocument();
    expect(screen.queryByText(/No threads yet/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    // Once on opening, once for Try again.
    expect(query.value.refetch).toHaveBeenCalledTimes(2);
  });
});
