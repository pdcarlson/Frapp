import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ThreadPanel } from "./thread-panel";
import type { ChatMessage } from "@repo/chat-core/types";

// `useAuthorAvatars` (#1231) is the one hook `ThreadPanel` calls unconditionally
// (every other `@repo/hooks` usage on this surface is a plain, non-hook helper),
// and it reaches for `FrappClientProvider`, which this file's bare `render()`
// does not mount. Stub just this one hook rather than replacing the module, so
// a future addition here doesn't need "No export is defined on the mock".
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuthorAvatars: () => ({ data: {} }) };
});

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OTHER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "hello",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

const nameFor = () => "Alice Chen";

/**
 * #1193: two `MessageItem` rows sharing one panel must share one reveal
 * id — tapping a second row's cluster open has to close the first's, or a
 * touch user builds up a screen full of stuck-open clusters as they browse a
 * thread. `MessageTimeline` owns the same contract for the centre pane; this
 * covers the non-virtualized panel directly.
 */
describe("ThreadPanel tap-to-reveal shares one id across its rows (#1193)", () => {
  function actionClusters(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(".absolute.top-0.z-10"),
    );
  }

  function renderPanel() {
    const parent = message({ id: "parent-1", client_message_id: "parent-1" });
    const reply = message({
      id: "reply-1",
      client_message_id: "reply-1",
      reply_to_id: "parent-1",
      content: "a reply",
    });

    return render(
      <ThreadPanel
        channelId={parent.channel_id}
        parent={parent}
        allMessages={[parent, reply]}
        viewerId={VIEWER}
        nameFor={nameFor}
        onClose={vi.fn()}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />,
    );
  }

  it("starts with neither row's cluster revealed", () => {
    const { container } = renderPanel();
    const [parentCluster, replyCluster] = actionClusters(container);

    expect(parentCluster!.className).toContain("opacity-0");
    expect(replyCluster!.className).toContain("opacity-0");
  });

  it("reveals the tapped row and dismisses the other on a second tap", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const [parentRow, replyRow] = rows;

    await user.click(parentRow!);
    const [parentCluster, replyCluster] = actionClusters(container);
    expect(parentCluster!.className).toContain("opacity-100");
    expect(replyCluster!.className).toContain("opacity-0");

    await user.click(replyRow!);
    const [parentClusterAfter, replyClusterAfter] = actionClusters(container);
    expect(parentClusterAfter!.className).toContain("opacity-0");
    expect(replyClusterAfter!.className).toContain("opacity-100");
  });

  it("tapping the same row twice closes it again", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    const [parentRow] = screen.getAllByRole("listitem");

    await user.click(parentRow!);
    await user.click(parentRow!);

    const [parentCluster] = actionClusters(container);
    expect(parentCluster!.className).toContain("opacity-0");
  });
});

/**
 * #396: the panel is a persistent `<aside>`, not a dialog, so nothing moves
 * focus into it or wires Escape for free the way Radix does for the slash
 * palette. `chat-shell.tsx` owns returning focus to whatever opened the
 * thread (the row's Reply control, most often); this covers what the panel
 * itself is responsible for.
 */
describe("ThreadPanel keyboard behavior (#396)", () => {
  function renderPanel(onClose = vi.fn()) {
    const parent = message({ id: "parent-1", client_message_id: "parent-1" });
    return {
      onClose,
      ...render(
        <ThreadPanel
          channelId={parent.channel_id}
          parent={parent}
          allMessages={[parent]}
          viewerId={VIEWER}
          nameFor={nameFor}
          onClose={onClose}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
        />,
      ),
    };
  }

  it("moves focus to the close button when a thread opens", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /close thread/i })).toHaveFocus();
  });

  it("closes on Escape from anywhere in the panel", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    // The mount effect above already focused the close button — Escape from
    // there is the case a keyboard user hits most often.
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when Escape's default was already prevented by a nested layer", () => {
    // A row's emoji-reaction popover (`ReactionQuickPick`, a Radix `Popover`)
    // dismisses itself on Escape via a document-level listener that calls
    // `preventDefault()` but not `stopPropagation()` — the same keydown still
    // bubbles here afterward. Simulating `defaultPrevented` directly, rather
    // than mounting a real popover, isolates the one thing this panel is
    // responsible for: not double-handling an Escape someone else already
    // claimed.
    const { onClose } = renderPanel();
    const closeButton = screen.getByRole("button", { name: /close thread/i });
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    closeButton.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Thread replies are real messages too — edit/delete are wired through the
 * panel exactly like `MessageTimeline` wires them for the centre pane, so a
 * moderator (or the author) doesn't lose the affordance just because a
 * message happens to be a reply.
 */
describe("ThreadPanel edit/delete wiring", () => {
  it("offers Edit on the viewer's own parent message and Delete on the other's reply with channels:manage", () => {
    const parent = message({
      id: "parent-1",
      client_message_id: "parent-1",
      sender_id: VIEWER,
    });
    const reply = message({
      id: "reply-1",
      client_message_id: "reply-1",
      reply_to_id: "parent-1",
      sender_id: OTHER,
      content: "a reply",
    });

    render(
      <ThreadPanel
        channelId={parent.channel_id}
        parent={parent}
        allMessages={[parent, reply]}
        viewerId={VIEWER}
        nameFor={nameFor}
        onClose={vi.fn()}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        canManageChannel
      />,
    );

    expect(screen.getAllByRole("button", { name: /edit/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /delete/i })).toHaveLength(2);
  });

  it("calls onDelete with the reply's id, not the parent's", async () => {
    const user = userEvent.setup();
    const parent = message({
      id: "parent-1",
      client_message_id: "parent-1",
      sender_id: VIEWER,
    });
    const reply = message({
      id: "reply-1",
      client_message_id: "reply-1",
      reply_to_id: "parent-1",
      sender_id: VIEWER,
      content: "a reply",
    });
    const onDelete = vi.fn();

    render(
      <ThreadPanel
        channelId={parent.channel_id}
        parent={parent}
        allMessages={[parent, reply]}
        viewerId={VIEWER}
        nameFor={nameFor}
        onClose={vi.fn()}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await user.click(deleteButtons[1]!);

    expect(onDelete).toHaveBeenCalledWith("reply-1");
  });
});

/**
 * #489. The panel renders `MessageItem`, which grew an unconditional quote
 * keyed on `message.reply_to_id`. Every row this panel shows has that field
 * set — the replies by construction (`allMessages.filter(m => m.reply_to_id
 * === parent.id)`), and the parent whenever it sits inside an imported Discord
 * chain — so a panel that does not pass `replyParent` captions every one of
 * them "Replying to a message that isn't loaded", each pointing at the row
 * directly above it.
 */
describe("ThreadPanel reply quotes (#489)", () => {
  function renderPanel(parent: ChatMessage, allMessages: ChatMessage[]) {
    return render(
      <ThreadPanel
        channelId={parent.channel_id}
        parent={parent}
        allMessages={allMessages}
        viewerId={VIEWER}
        nameFor={nameFor}
        onClose={vi.fn()}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />,
    );
  }

  it("does not claim a reply's parent is unloaded when it is the row above", () => {
    const parent = message({ id: "parent-1", content: "the original" });
    const reply = message({
      id: "reply-1",
      content: "agreed",
      reply_to_id: "parent-1",
      client_message_id: "client-2",
    });

    renderPanel(parent, [parent, reply]);

    // Twice, and that is the fix: once as the parent's own body, once as the
    // preview inside the reply's quote. Before this it appeared once, and the
    // reply carried "Replying to a message that isn't loaded" instead.
    expect(screen.getAllByText("the original")).toHaveLength(2);
    expect(screen.getByText("agreed")).toBeInTheDocument();
    expect(screen.queryByText(/isn’t loaded/i)).not.toBeInTheDocument();
  });

  it("resolves the collected message's own parent when it is itself a reply", () => {
    // Root normalization is one hop, and `linkReplyPairs` writes genuinely
    // nested chains during an archive import — so the panel's header row can be
    // a mid-chain node whose parent is sitting in the same window.
    const grandparent = message({ id: "gp-1", content: "the first word" });
    const parent = message({
      id: "parent-1",
      content: "a middle reply",
      reply_to_id: "gp-1",
      client_message_id: "client-2",
    });

    renderPanel(parent, [grandparent, parent]);

    expect(screen.getByText("the first word")).toBeInTheDocument();
    expect(screen.queryByText(/isn’t loaded/i)).not.toBeInTheDocument();
  });

  it("still says so when the collected message's parent really is unloaded", () => {
    // The honest case must survive the fix: `undefined` (not a reply) and
    // `null` (a reply whose parent is not loaded) stay distinguishable.
    const parent = message({
      id: "parent-1",
      content: "a middle reply",
      reply_to_id: "aged-out",
    });

    renderPanel(parent, [parent]);

    expect(screen.getByText(/isn’t loaded/i)).toBeInTheDocument();
  });

  it("does not tell the member to start a thread it has no composer for", () => {
    // The panel is a read-only collector reached from a reply's quote; replies
    // are authored on the row in the centre timeline.
    const parent = message({ id: "parent-1" });

    renderPanel(parent, [parent]);

    expect(screen.queryByText(/start the thread/i)).not.toBeInTheDocument();
    expect(screen.getByText(/use reply on the message/i)).toBeInTheDocument();
  });
});
