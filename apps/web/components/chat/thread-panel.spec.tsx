import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { normalizeRow } from "@repo/chat-core/types";
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
  discard: vi.fn(),
  emitTyping: vi.fn(),
};
let offline = false;

vi.mock("@/lib/chat/use-message-thread", () => ({
  useMessageThread: () => thread,
}));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: offline }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ThreadPanel } from "./thread-panel";

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

function renderPanel(overrides: Partial<{ canReply: boolean }> = {}) {
  const onClose = vi.fn();
  render(
    <ThreadPanel
      channelId="c1"
      channelName="announcements"
      rootId="root"
      viewerId="me"
      nameFor={(id) => names[id] ?? null}
      blockState={readyBlocks}
      canReply={overrides.canReply ?? true}
      onClose={onClose}
    />,
  );
  return { onClose };
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

  it("names who is typing, never the viewer or a blocked member", () => {
    thread.typingUsers = ["paul", "me", "blocked", "shawn"];
    renderPanel();
    expect(screen.getByText("Paul and Shawn are typing…")).toBeInTheDocument();
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
});
