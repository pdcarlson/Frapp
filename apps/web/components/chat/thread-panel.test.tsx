import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ThreadPanel } from "./thread-panel";
import type { ChatMessage } from "@repo/chat-core/types";

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
