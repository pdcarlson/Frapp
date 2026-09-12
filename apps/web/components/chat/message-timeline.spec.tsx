import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { UNAVAILABLE_QUOTE } from "./reply-quote";

/**
 * `react-virtuoso` measures with `ResizeObserver` and renders nothing in jsdom,
 * so the real virtualizer would make every assertion below vacuous. Stubbed to
 * a plain list that renders every item through the same `itemContent` the
 * component passes it — which is the part under test: what `MessageTimeline`
 * hands each row, not how Virtuoso windows them.
 */
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}));

// `useAuthorAvatars` reaches for `FrappClientProvider`, which a bare `render()`
// does not mount.
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuthorAvatars: () => ({ data: {} }) };
});

const { MessageTimeline } = await import("./message-timeline");

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

const nameFor = (id: string) =>
  id === ALICE ? "Alice Chen" : id === BOB ? "Bob Ruiz" : null;

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: ALICE,
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

function renderTimeline(
  messages: ChatMessage[],
  overrides: Record<string, unknown> = {},
) {
  return render(
    <MessageTimeline
      channelId="chan-1"
      messages={messages}
      viewerId={VIEWER}
      nameFor={nameFor}
      isLoading={false}
      loadError={null}
      onReact={vi.fn()}
      onUnreact={vi.fn()}
      {...overrides}
    />,
  );
}

/**
 * #489 AC (b): "Replies with `reply_to_id` render parent quote + body in the
 * main timeline."
 *
 * This file exists because that AC had **no coverage at all**. `MessageTimeline`
 * is the only place the main timeline resolves a reply's parent, and the one
 * suite that renders the shell mocks the whole component away — so deleting the
 * `replyParent` wiring left the entire suite green while every reply in the
 * primary chat surface captioned itself "Original message not loaded".
 */
describe("MessageTimeline reply quotes (#489)", () => {
  const PARENT = message({
    id: "parent-1",
    sender_id: ALICE,
    content: "the original",
  });
  const REPLY = message({
    id: "reply-1",
    sender_id: BOB,
    content: "agreed",
    reply_to_id: "parent-1",
    client_message_id: "client-2",
    created_at: new Date(2026, 7, 16, 17, 40).toISOString(),
  });

  it("renders a reply's parent as a quote above its body", () => {
    renderTimeline([PARENT, REPLY]);

    expect(screen.getByText("agreed")).toBeInTheDocument();
    // Twice: the parent's own bubble, and the preview inside the reply's quote.
    expect(screen.getAllByText("the original")).toHaveLength(2);
    expect(screen.queryByText(UNAVAILABLE_QUOTE)).not.toBeInTheDocument();
  });

  it("captions the quote with the PARENT's author, not the replier's", () => {
    // The mutation this catches renders every quote under the replier's name —
    // and because `resolveAuthorLabel` says "You" for the viewer's own rows, a
    // member's own reply would caption someone else's words with "You".
    // `onJumpToParent` is always wired by `chat-shell.tsx`, and it is what
    // makes the quote a button — the handle this assertion needs.
    renderTimeline([PARENT, REPLY], { onJumpToParent: vi.fn() });

    // Bob wrote the reply; the quote above it must name Alice.
    const quote = screen.getByRole("button", { name: /the original/i });
    expect(quote).toHaveTextContent("Alice Chen");
    expect(quote).not.toHaveTextContent("Bob Ruiz");
  });

  it("says so when a reply's parent is outside the loaded window", () => {
    // Nothing backfills older history (#1571), so this is every reply to a
    // message older than the one window the channel loads.
    renderTimeline([message({ id: "reply-1", reply_to_id: "aged-out" })]);

    expect(screen.getByText(UNAVAILABLE_QUOTE)).toBeInTheDocument();
  });

  it("renders no quote on a message that is not a reply", () => {
    renderTimeline([PARENT]);

    expect(screen.queryByText(UNAVAILABLE_QUOTE)).not.toBeInTheDocument();
    expect(screen.getAllByText("the original")).toHaveLength(1);
  });

  it("jumps to the quoted message from a reply's quote (#2142)", async () => {
    // The quote used to open `ThreadPanel` in the Details rail. #2142 deleted
    // both; the quote now scrolls this timeline to the message it quotes, which
    // is the same conversation with a composer under it rather than a read-only
    // copy of it in a third column.
    const user = userEvent.setup();
    const onJumpToParent = vi.fn();
    renderTimeline([PARENT, REPLY], { onJumpToParent });

    await user.click(screen.getByRole("button", { name: /the original/i }));

    expect(onJumpToParent).toHaveBeenCalledWith(PARENT);
  });

  it("hands the Reply control through to each row", async () => {
    // Deleting `onReply={onReply}` from the timeline removes the Reply control
    // from every web surface — AC (a)'s entry point — and was invisible to the
    // whole suite before this file existed.
    const user = userEvent.setup();
    const onReply = vi.fn();
    renderTimeline([PARENT], { onReply });

    await user.click(screen.getByRole("button", { name: /^reply$/i }));

    expect(onReply).toHaveBeenCalledWith(PARENT);
  });
});

/**
 * #2145: the loading state is the one frame on this route that a cold load and
 * every channel switch both pass through, so its geometry is the geometry the
 * timeline shifts by.
 *
 * These assert the shape rather than a rendered pixel count, which is what a
 * jsdom harness can honestly know: jsdom computes no layout, so a test here can
 * only check that the placeholder is built from the same box metrics as a real
 * row, not that the two measure the same. The measured half is in the PR — the
 * reason these exist at all is that the *cause* is checkable cheaply and the
 * effect is not.
 */
describe("MessageTimeline loading state (#2145)", () => {
  it("reserves row geometry instead of drawing a card", () => {
    // The `LoadingState` this replaced was `min-h-52 rounded-xl border bg-card`
    // — a 208px centred panel standing in for a full column of rows. `1s`:
    // "the rest of the window is skeleton with reserved geometry", and zero CLS
    // above the composer.
    const { container } = renderTimeline([], { isLoading: true });

    expect(container.querySelector(".rounded-xl")).toBeNull();
    expect(container.querySelector(".min-h-52")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    const rows = container.querySelectorAll(".px-5.pb-1");
    expect(rows.length).toBeGreaterThan(0);
    // The metrics `MessageItem` draws: 32px avatar gutter, 10px gap, and the
    // header/grouped padding pair. A skeleton that drifts from these moves the
    // first real row by the difference.
    for (const row of rows) {
      expect(row.className).toContain("gap-2.5");
      expect(row.className).toMatch(/\bpt-4\b|\bpt-1\b/);
      expect(row.querySelector(".w-8")).not.toBeNull();
    }
  });

  it("draws both grouped and headed rows, as a real channel does", () => {
    // A run of same-author messages is most of a channel, and a grouped row has
    // no avatar and no name line. An all-headed skeleton would reserve more
    // height than the rows that replace it.
    const { container } = renderTimeline([], { isLoading: true });

    const rows = [...container.querySelectorAll(".px-5.pb-1")];
    expect(rows.some((r) => r.className.includes("pt-4"))).toBe(true);
    expect(rows.some((r) => r.className.includes("pt-1"))).toBe(true);
  });

  it("is bottom-aligned, where the timeline actually opens", () => {
    // `initialTopMostItemIndex` is the last row and the composer is pinned
    // below, so content arrives against the bottom edge. Reserving the space at
    // the top would be the right amount in the wrong place.
    const { container } = renderTimeline([], { isLoading: true });

    expect(container.querySelector(".justify-end")).not.toBeNull();
  });

  it("hides itself from assistive tech, which chat-shell announces instead", () => {
    // Ten anonymous rectangles are no use read aloud, and `chat-shell.tsx` owns
    // one `role="status"` for the whole cold load — announcing here too would
    // read the same event twice.
    const { container } = renderTimeline([], { isLoading: true });

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
