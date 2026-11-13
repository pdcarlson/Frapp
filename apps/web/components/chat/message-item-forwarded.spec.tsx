import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TOMBSTONE_TEXT, HELD_QUOTE_TEXT } from "@repo/chat-core/block-copy";
import { normalizeRow, type RawForwardedFrom } from "@repo/chat-core/types";
import type { BlockState } from "@repo/chat-core/blocks";
import { MessageItem } from "./message-item";
import { NOBODY_BLOCKED, blockState } from "@/tests/block-list";

// The forward card (#4864): "Forwarded", the original's author and time, its
// channel only where the viewer's list holds it, its text through the body's
// markdown renderer, its GIF and its file count; the block placeholder for a
// blocked author, and the deleted line for a blanked copy.

const CHANNELS = [
  { id: "chan-src", name: "general", type: "PUBLIC" },
  { id: "dm-1", name: "Alice Chen", type: "DM" },
];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChannels: () => ({ data: CHANNELS, isPending: false }),
}));

const VIEWER = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";
const FORWARDER = "33333333-3333-4333-8333-333333333333";

const GIF = {
  provider: "klipy",
  id: "g1",
  title: "party",
  url: "https://static.klipy.com/g1.webp",
  width: 200,
  height: 100,
};

const nameFor = (id: string) =>
  id === AUTHOR ? "Alice Chen" : id === FORWARDER ? "Jake Smith" : null;

function forward(
  copy: Partial<RawForwardedFrom> = {},
  overrides: { content?: string; sender_blocked?: boolean } = {},
) {
  return normalizeRow({
    id: "m1",
    channel_id: "chan-dest",
    sender_id: FORWARDER,
    content: overrides.content ?? "",
    kind: "text",
    created_at: new Date(2026, 10, 13, 18, 0).toISOString(),
    sender_blocked: overrides.sender_blocked ?? false,
    forwarded_from: {
      message_id: "orig-1",
      channel_id: "chan-src",
      sender_id: AUTHOR,
      author_name: "Alice Chen",
      content: "see you at **8**",
      gif: null,
      attachment_count: 0,
      created_at: new Date(2026, 10, 12, 20, 0).toISOString(),
      ...copy,
    },
  });
}

function renderForward(
  msg: ReturnType<typeof forward>,
  state: BlockState = NOBODY_BLOCKED,
) {
  render(
    <div role="list">
      <MessageItem
        blockState={state}
        message={msg}
        viewerId={VIEWER}
        showHeader
        nameFor={nameFor}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        isTapRevealed={false}
        onToggleTapReveal={vi.fn()}
      />
    </div>,
  );
  return document.querySelector<HTMLElement>("[data-slot=forwarded-card]");
}

describe("MessageItem forward card", () => {
  it("draws the label, the author, the time, the channel and the rendered text", () => {
    const card = renderForward(forward())!;
    expect(card).not.toBeNull();
    const scope = within(card);
    expect(scope.getByText("Forwarded")).toBeInTheDocument();
    expect(scope.getByText("Alice Chen")).toBeInTheDocument();
    expect(card.querySelector("time")).toHaveAttribute(
      "datetime",
      new Date(2026, 10, 12, 20, 0).toISOString(),
    );
    expect(scope.getByText("in #general")).toBeInTheDocument();
    // Markdown renders, so the bold draws as bold rather than as asterisks.
    expect(scope.getByText("8").tagName).toBe("STRONG");
    // The forwarder still heads the row.
    expect(screen.getByText("Jake Smith")).toBeInTheDocument();
  });

  it("draws the forwarder's comment above the card", () => {
    renderForward(forward({}, { content: "look at this" }));
    expect(screen.getByText("look at this")).toBeInTheDocument();
  });

  it("names no channel the viewer's list doesn't hold, and never a DM", () => {
    let card = renderForward(forward({ channel_id: "chan-private" }))!;
    expect(within(card).queryByText(/^in #/)).toBeNull();
    document.body.innerHTML = "";
    card = renderForward(forward({ channel_id: "dm-1" }))!;
    expect(within(card).queryByText(/^in #/)).toBeNull();
  });

  it("draws the GIF and counts the files", () => {
    const card = renderForward(
      forward({ content: "", gif: GIF, attachment_count: 3 }),
    )!;
    expect(within(card).getByTestId("message-gif")).toBeInTheDocument();
    expect(within(card).getByText("3 attachments")).toBeInTheDocument();
  });

  it("draws a blocked author's copy as the block placeholder, with nothing they wrote", () => {
    const card = renderForward(
      forward({ gif: GIF, attachment_count: 1 }),
      blockState("ready", { ids: [AUTHOR] }),
    )!;
    const scope = within(card);
    expect(scope.getByText("Forwarded")).toBeInTheDocument();
    expect(scope.getByText(TOMBSTONE_TEXT)).toBeInTheDocument();
    expect(scope.queryByText("Alice Chen")).toBeNull();
    expect(scope.queryByText(/see you/)).toBeNull();
    expect(scope.queryByTestId("message-gif")).toBeNull();
    expect(scope.queryByText(/attachment/)).toBeNull();
  });

  it("holds an echoed copy while the list can't be read", () => {
    const echoed = { ...forward(), _blockEvaluated: false };
    const card = renderForward(echoed, blockState("unavailable"))!;
    expect(within(card).getByText(HELD_QUOTE_TEXT)).toBeInTheDocument();
  });

  it("says the original was deleted for a blanked copy", () => {
    const card = renderForward(forward({ deleted: true }))!;
    expect(
      within(card).getByText("Original message was deleted"),
    ).toBeInTheDocument();
    expect(within(card).queryByText("Alice Chen")).toBeNull();
  });

  it("draws no card on a deleted forward or an ordinary message", () => {
    expect(renderForward({ ...forward(), is_deleted: true })).toBeNull();
    document.body.innerHTML = "";
    expect(
      renderForward({ ...forward(), forwarded_from: null, content: "hi" }),
    ).toBeNull();
  });
});
