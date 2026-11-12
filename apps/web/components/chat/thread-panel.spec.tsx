import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { normalizeRow, reactionActionType } from "@repo/chat-core/types";
import type { BlockState } from "@repo/chat-core/blocks";

const thread = {
  root: null as ChatMessage | null,
  followState: null as "following" | "muted" | null,
  metaError: null,
  isLoading: false,
  repliesError: null,
  retryLoad: vi.fn(),
  messages: [] as ChatMessage[],
  hasOlder: false,
  isLoadingOlder: false,
  loadOlder: vi.fn(),
  typingUsers: [] as readonly string[],
  setFollow: vi.fn(async () => undefined),
  send: vi.fn(async () => ({ error: null as string | null })),
  retry: vi.fn(async () => ({ error: null as string | null })),
  discard: vi.fn(),
  refreshRoot: vi.fn(),
  emitTyping: vi.fn(),
};
let offline = false;

// Chat backgrounds (#3973) read their own query; decoration, not under test here.
vi.mock("./chat-background", () => ({ ChatBackground: () => null }));

// `react-virtuoso` renders nothing in jsdom; stood in by a plain list that
// draws its header and every item, as `message-timeline.spec.tsx` does.
vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  return {
    Virtuoso: React.forwardRef(function Virtuoso({
      data,
      itemContent,
      components,
      context,
    }: {
      data: unknown[];
      itemContent: (index: number, item: unknown) => React.ReactNode;
      components?: {
        Header?: (props: { context?: unknown }) => React.ReactNode;
      };
      context?: unknown;
    }) {
      const Header = components?.Header;
      return (
        <div>
          {Header ? <Header context={context} /> : null}
          {data.map((item, index) => (
            <div key={index}>{itemContent(index, item)}</div>
          ))}
        </div>
      );
    }),
  };
});

// `useAuthorAvatars` needs `FrappClientProvider`, which a bare render lacks.
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuthorAvatars: () => ({ data: {} }) };
});

// Radix mounts an avatar's `<img>` only once the browser loads it, which
// jsdom never does: a marker carrying the `src` stands in.
vi.mock("@/components/ui/avatar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AvatarImage: ({ src }: { src?: string }) => (
      <span data-testid="avatar-photo" data-src={src} />
    ),
  };
});

vi.mock("@/lib/chat/use-message-thread", () => ({
  useMessageThread: () => thread,
}));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: offline }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ThreadPanel, type ThreadRowWrites } from "./thread-panel";

function row(id: string, senderId: string, content: string): ChatMessage {
  return normalizeRow({
    id,
    channel_id: "c1",
    sender_id: senderId,
    kind: "text",
    content,
    created_at: "2026-11-10T12:00:00.000Z",
  } as never);
}

const names: Record<string, string> = {
  paul: "Paul",
  shawn: "Shawn",
  me: "Winston",
  blocked: "Blocked Person",
};
const readyBlocks: BlockState = {
  status: "ready",
  ids: new Set(["blocked"]),
  unblocked: new Set(),
  cleared: new Set(),
} as unknown as BlockState;

function makeWrites() {
  return {
    react: vi.fn(async () => undefined),
    unreact: vi.fn(async () => undefined),
    edit: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    closePoll: vi.fn(async () => undefined),
    act: vi.fn(async () => undefined),
  } satisfies ThreadRowWrites;
}

function renderPanel(
  overrides: Partial<{
    canReply: boolean;
    canPost: boolean;
    heldRoot: ChatMessage | null;
    avatarFor: (id: string) => string | null;
    onClosePanel: () => void;
  }> = {},
) {
  const onClose = vi.fn();
  const writes = makeWrites();
  const onUnblock = vi.fn();
  render(
    <ThreadPanel
      channelId="c1"
      channelName="announcements"
      rootId="root"
      viewerId="me"
      nameFor={(id) => names[id] ?? null}
      avatarFor={overrides.avatarFor ?? (() => null)}
      blockState={readyBlocks}
      heldRoot={overrides.heldRoot ?? null}
      writes={writes}
      onUnblock={onUnblock}
      onReloadMasked={vi.fn()}
      maskedRefresh={new Map()}
      canReply={overrides.canReply ?? true}
      canPost={overrides.canPost ?? true}
      onClose={onClose}
      onClosePanel={overrides.onClosePanel}
    />,
  );
  return { onClose, writes, onUnblock };
}

describe("ThreadPanel (#3785)", () => {
  beforeEach(() => {
    offline = false;
    thread.root = row("root", "paul", "Who's driving Saturday?");
    thread.messages = [row("r1", "shawn", "I can take four")];
    thread.followState = null;
    thread.typingUsers = [];
    thread.send.mockClear();
    thread.setFollow.mockClear();
    thread.refreshRoot.mockClear();
    thread.retry.mockClear();
  });

  it("shows the parent, the reply count and the replies", () => {
    renderPanel();
    expect(screen.getByText("Who's driving Saturday?")).toBeInTheDocument();
    expect(screen.getByText("1 reply")).toBeInTheDocument();
    expect(screen.getByText("I can take four")).toBeInTheDocument();
    expect(screen.getByText("#announcements")).toBeInTheDocument();
  });

  it("sends a reply on Enter", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Reply in thread" }),
      "Me too{Enter}",
    );
    expect(thread.send).toHaveBeenCalledWith("Me too");
  });

  it("follows and unfollows", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Follow" }));
    expect(thread.setFollow).toHaveBeenCalledWith("following");
  });

  it("unfollows a followed thread", async () => {
    thread.followState = "following";
    renderPanel();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Following" }));
    expect(thread.setFollow).toHaveBeenCalledWith("none");
  });

  it("offers no composer where the viewer can't reply", () => {
    renderPanel({ canReply: false });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByText("You can't reply in this channel."),
    ).toBeInTheDocument();
  });

  it("tombstones a blocked member's reply", () => {
    thread.messages = [row("r2", "blocked", "secret words")];
    renderPanel();
    expect(screen.queryByText("secret words")).not.toBeInTheDocument();
    expect(
      screen.getByText("Message from a member you blocked"),
    ).toBeInTheDocument();
  });

  it("keeps a half-typed reply on Escape, and closes on Escape otherwise", async () => {
    const { onClose } = renderPanel();
    const user = userEvent.setup();
    const box = screen.getByRole("textbox", { name: "Reply in thread" });
    await user.type(box, "draft");
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await user.clear(box);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names who is typing, never the viewer or a blocked member", () => {
    thread.typingUsers = ["paul", "me", "blocked", "shawn"];
    renderPanel();
    expect(screen.getByText("Paul and Shawn are typing…")).toBeInTheDocument();
  });

  it("keeps the typing line's place when nobody types, so the reply box never moves", () => {
    thread.typingUsers = [];
    renderPanel();
    const line = screen.getByTestId("typing-line");
    expect(line).toBeEmptyDOMElement();
    expect(line.className).toContain("h-5");
    expect(line).toHaveAttribute("aria-hidden", "true");
  });

  it("announces typing only while the reply box holds text", async () => {
    const user = userEvent.setup();
    thread.emitTyping.mockClear();
    renderPanel();
    const box = screen.getByRole("textbox", { name: "Reply in thread" });
    await user.type(box, "  ");
    expect(thread.emitTyping).not.toHaveBeenCalled();
    await user.type(box, "hi");
    expect(thread.emitTyping).toHaveBeenCalled();
  });

  it("disables the composer offline and says why", () => {
    offline = true;
    renderPanel();
    expect(
      screen.getByRole("textbox", { name: "Reply in thread" }),
    ).toBeDisabled();
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  });

  it("goes back to the channel", async () => {
    const { onClose } = renderPanel();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Back to channel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("carries chat's Close chat X over the channel header it covers, only when handed one (#4223)", async () => {
    const onClosePanel = vi.fn();
    const { onClose } = renderPanel({ onClosePanel });
    const close = screen.getByRole("button", { name: "Close chat" });
    // 16px from the panel's edge against the thread header's 8px gutter.
    expect(close).toHaveClass("h-9", "w-9", "mr-2");
    await userEvent.setup().click(close);
    expect(onClosePanel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("draws no Close chat X with chat alone", () => {
    renderPanel();
    expect(
      screen.queryByRole("button", { name: "Close chat" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Full rows (#4034): a reply is drawn by the timeline's own row, so it
 * carries reactions, the edited marker, photos, Edit and Delete, and each
 * write names the cache it lands in: the thread's for a reply, the
 * channel's (and a re-read of the parent) for the parent.
 */
describe("ThreadPanel full rows (#4034)", () => {
  const thumbs = reactionActionType("👍");

  function rowOf(text: string): HTMLElement {
    const item = screen
      .getByText(text)
      .closest<HTMLElement>('[role="listitem"]');
    if (!item) throw new Error(`no row for ${text}`);
    return item;
  }

  beforeEach(() => {
    offline = false;
    thread.root = row("root", "paul", "Who's driving Saturday?");
    thread.messages = [row("r1", "shawn", "I can take four")];
    thread.followState = null;
    thread.typingUsers = [];
    thread.refreshRoot.mockClear();
    thread.retry.mockClear();
    thread.hasOlder = false;
  });

  it("routes a reply's reaction to the thread's cache", async () => {
    thread.messages = [
      {
        ...row("r1", "shawn", "I can take four"),
        reactions: { [thumbs]: ["me"] },
      },
    ];
    const { writes } = renderPanel();
    await userEvent.setup().click(
      within(rowOf("I can take four")).getByRole("button", {
        name: /^👍 reaction, 1, including you/,
      }),
    );
    expect(writes.unreact).toHaveBeenCalledWith("r1", "👍", "root");
    expect(thread.refreshRoot).not.toHaveBeenCalled();
  });

  it("routes the parent's reaction to the channel's cache and re-reads it", async () => {
    thread.root = {
      ...row("root", "paul", "Who's driving Saturday?"),
      reactions: { [thumbs]: ["shawn"] },
    };
    const { writes } = renderPanel();
    await userEvent.setup().click(
      within(rowOf("Who's driving Saturday?")).getByRole("button", {
        name: /^👍 reaction, 1/,
      }),
    );
    expect(writes.react).toHaveBeenCalledWith("root", "👍", null);
    // The timeline doesn't hold this parent, so it is read again once the
    // write has settled.
    await waitFor(() => expect(thread.refreshRoot).toHaveBeenCalled());
  });

  it("re-reads an unheld parent only once its write settles", async () => {
    thread.root = {
      ...row("root", "paul", "Who's driving Saturday?"),
      reactions: { [thumbs]: ["shawn"] },
    };
    let settle!: () => void;
    const { writes } = renderPanel();
    writes.react.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          settle = () => resolve(undefined);
        }),
    );
    await userEvent.setup().click(
      within(rowOf("Who's driving Saturday?")).getByRole("button", {
        name: /^👍 reaction, 1/,
      }),
    );
    expect(writes.react).toHaveBeenCalled();
    expect(thread.refreshRoot).not.toHaveBeenCalled();
    settle();
    await waitFor(() => expect(thread.refreshRoot).toHaveBeenCalledTimes(1));
  });

  it("deletes an unheld parent and reads it again", async () => {
    thread.root = row("root", "me", "My question");
    const { writes } = renderPanel();
    await userEvent
      .setup()
      .click(
        within(rowOf("My question")).getByRole("button", { name: "Delete" }),
      );
    expect(writes.delete).toHaveBeenCalledWith("root", null);
    await waitFor(() => expect(thread.refreshRoot).toHaveBeenCalled());
  });

  it("leaves a parent the timeline holds to the timeline's live copy", async () => {
    const held = {
      ...row("root", "paul", "Who's driving Saturday?"),
      reactions: { [thumbs]: ["shawn"] },
    };
    const { writes } = renderPanel({ heldRoot: held });
    await userEvent.setup().click(
      within(rowOf("Who's driving Saturday?")).getByRole("button", {
        name: /^👍 reaction, 1/,
      }),
    );
    expect(writes.react).toHaveBeenCalledWith("root", "👍", null);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(thread.refreshRoot).not.toHaveBeenCalled();
  });

  it("shows the parent while older replies are still to load", () => {
    thread.hasOlder = true;
    renderPanel();
    expect(screen.getByText("Who's driving Saturday?")).toBeInTheDocument();
    expect(screen.getByText("1 reply")).toBeInTheDocument();
    expect(screen.getByText("I can take four")).toBeInTheDocument();
  });

  it("draws the edited marker and the author's photo on a reply", () => {
    thread.messages = [
      {
        ...row("r1", "shawn", "I can take four"),
        edited_at: "2026-11-10T12:05:00.000Z",
      },
    ];
    renderPanel({
      avatarFor: (id) => (id === "shawn" ? "https://img.test/shawn.png" : null),
    });
    const reply = rowOf("I can take four");
    expect(within(reply).getByText(/edited/)).toBeInTheDocument();
    expect(within(reply).getByTestId("avatar-photo")).toHaveAttribute(
      "data-src",
      "https://img.test/shawn.png",
    );
  });

  it("deletes the viewer's own reply in the thread", async () => {
    thread.messages = [row("r1", "me", "My reply")];
    const { writes } = renderPanel();
    await userEvent
      .setup()
      .click(within(rowOf("My reply")).getByRole("button", { name: "Delete" }));
    expect(writes.delete).toHaveBeenCalledWith("r1", "root");
  });

  it("edits a reply under the thread rule, the parent only where the viewer can post", () => {
    thread.root = row("root", "me", "My question");
    thread.messages = [row("r1", "me", "My reply")];
    renderPanel({ canPost: false, canReply: true });
    expect(
      within(rowOf("My reply")).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(rowOf("My question")).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("prefers the channel's live copy of the parent", () => {
    renderPanel({
      heldRoot: {
        ...row("root", "paul", "Who's driving Saturday? (updated)"),
      },
    });
    expect(
      screen.getByText("Who's driving Saturday? (updated)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Who's driving Saturday?"),
    ).not.toBeInTheDocument();
  });

  it("retries a failed reply by its client id", async () => {
    thread.messages = [
      {
        ...row("r1", "me", "Lost reply"),
        client_message_id: "client-r1",
        _status: "failed",
        _error: "Network",
      },
    ];
    renderPanel();
    await userEvent
      .setup()
      .click(
        within(rowOf("Lost reply")).getByRole("button", { name: /Retry/ }),
      );
    expect(thread.retry).toHaveBeenCalledWith("client-r1");
  });

  it("tombstones a blocked member's parent, with Unblock", async () => {
    thread.root = row("root", "blocked", "secret question");
    const { onUnblock } = renderPanel();
    expect(screen.queryByText("secret question")).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Unblock/ }));
    expect(onUnblock).toHaveBeenCalledWith("blocked");
  });

  it("draws the parent once, without its own thread chip", () => {
    thread.root = {
      ...row("root", "paul", "Who's driving Saturday?"),
      thread: {
        reply_count: 3,
        last_reply_at: "2026-11-10T12:00:00.000Z",
        recent_sender_ids: ["shawn"],
      },
    } as ChatMessage;
    renderPanel();
    expect(screen.getByText("3 replies")).toBeInTheDocument();
    expect(screen.queryByText(/last reply/)).not.toBeInTheDocument();
  });
});
