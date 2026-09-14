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

  it("reserves the message BUBBLE, not a bare line", () => {
    /*
      The assertion the first version of this suite was missing, and the reason
      it shipped a skeleton that reserved about half the height it stood in for.

      Every other test here checks the row *wrapper*, whose classes were correct
      all along. The height lives in the body: `TextRenderer` draws
      `mt-1 px-4 py-3 leading-[25px]` inside a bordered bubble — 55px for one
      line — where the skeleton drew a 13px bar. jsdom computes no layout, so
      nothing measurable goes red; the only durable check is that the placeholder
      is built from the same box declarations as the thing it replaces.
    */
    const { container } = renderTimeline([], { isLoading: true });

    const bubbles = container.querySelectorAll(".px-4.py-3");
    expect(bubbles.length).toBe(
      container.querySelectorAll(".px-5.pb-1").length,
    );
    for (const bubble of bubbles) {
      // `TextRenderer`'s box, class for class.
      expect(bubble.className).toContain("mt-1");
      expect(bubble.className).toContain("border");
      // The line box inside it, not a 13px text-line placeholder.
      expect(bubble.querySelector(".h-\\[25px\\]")).not.toBeNull();
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

  it("hides the blocks from assistive tech but still announces the load", () => {
    // Both halves, because the first without the second is a regression rather
    // than a feature. The `LoadingState` this replaced carried `role="status"`
    // and a "Loading messages…" caption; an `aria-hidden` skeleton on its own
    // would have made every channel switch silent to a screen reader, and
    // `chat-shell.tsx`'s announcer says "Loading channels", which is a
    // different event.
    renderTimeline([], { isLoading: true });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading messages");
    expect(status).toHaveClass("sr-only");

    // The rectangles themselves stay hidden: ten anonymous blocks read aloud
    // are noise, and the region above is what carries the meaning.
    const skeleton = document.querySelector('[aria-hidden="true"].justify-end');
    expect(skeleton).not.toBeNull();
  });
});

/**
 * The own-message mis-ID on load (#2243).
 *
 * `viewerId` decides which of the two shapes `components.md` §11 draws a bubble
 * in, and it arrives on its own clock — `GET /v1/users/me`, which the first
 * chunk's Dexie read (#2227) regularly beats. It used to arrive as `null` into a
 * row that treated `null` as "not mine", so on staging the signed-in member's
 * own messages painted as a stranger's: left, incoming chrome, and labelled with
 * the first six hex of their own uuid because `resolveAuthorLabel` had skipped
 * its "You" branch.
 *
 * These assert the *absence* of that paint rather than the presence of a
 * skeleton, because the skeleton is the current answer and not the requirement.
 * Anything that draws a row before identity lands has to guess which side it
 * goes on, and the bug is the guess.
 */
describe("MessageTimeline identity gate (#2243)", () => {
  const bubbles = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-slot="bubble"]'));

  it("paints no row at all while the viewer is unknown", () => {
    renderTimeline([message({ sender_id: VIEWER, content: "mine" })], {
      viewerId: null,
    });

    // The whole of the fix: a row the member wrote is not drawn as somebody
    // else's, and the way it is not drawn as somebody else's is that it is not
    // drawn yet.
    expect(bubbles()).toHaveLength(0);
    expect(screen.queryByText("mine")).not.toBeInTheDocument();
    // `Member 111111` and `11` are `memberFallbackLabel` and
    // `authorInitialsFallback` reading the *viewer's own* id back to them — the
    // "Member … · BF" staging reported, spelled with this file's uuids. Asserted
    // here rather than in a test of their own: with no rows drawn they cannot
    // appear whatever those helpers produce, so alone they would pin nothing.
    expect(screen.queryByText("Member 111111")).not.toBeInTheDocument();
    expect(screen.queryByText("11")).not.toBeInTheDocument();
  });

  it("shows a load failure rather than burying it behind the identity gate", () => {
    // An expired session is the likeliest route to an unresolved viewer, and it
    // takes out the messages fetch with the same 401. The error has a retry; the
    // skeleton has no exit, so the error has to win.
    renderTimeline([message({ sender_id: VIEWER })], {
      viewerId: null,
      loadError: new Error("401"),
    });

    expect(screen.getByText("Couldn't load messages")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("still paints another member's row as incoming once identity settles", () => {
    // The positive half, and not implied by the own-row case: a gate that opened
    // into *every* row taking the self shape would pass every assertion above.
    renderTimeline([message({ sender_id: ALICE, content: "from alice" })], {
      viewerId: VIEWER,
    });

    const [bubble] = bubbles();
    expect(bubble?.className).toContain("bg-card");
    expect(bubble?.className).toContain("border-border");
    expect(bubble?.className).toContain("rounded-bl-[6px]");
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
  });

  it("withholds an incoming row too, not just the member's own", () => {
    // Not an over-reach: while the viewer is unknown *any* row could be theirs,
    // so there is no subset that is safe to draw early. Asserted so a later
    // optimisation cannot narrow the gate to "own rows only" — which is
    // undecidable at exactly the moment it would have to decide.
    renderTimeline([message({ sender_id: ALICE, content: "from alice" })], {
      viewerId: null,
    });

    expect(bubbles()).toHaveLength(0);
    expect(screen.queryByText("from alice")).not.toBeInTheDocument();
  });

  it("still tells a screen reader the timeline is loading", () => {
    // The gate reuses the `isLoading` branch, so it inherits that branch's
    // announcer rather than going silent — an unresolved viewer is a load in
    // progress, and #2145 already ruled that a silent one is a regression.
    renderTimeline([message({ sender_id: VIEWER })], { viewerId: null });

    expect(screen.getByRole("status")).toHaveTextContent("Loading messages");
  });

  it("paints the member's own row as theirs once identity settles", () => {
    // The other half of the bar: withholding must be transient. A gate that
    // never opened would trade a wrong author for a permanent skeleton.
    const rows = [message({ sender_id: VIEWER, content: "mine" })];
    const { rerender } = render(
      <MessageTimeline
        channelId="chan-1"
        messages={rows}
        viewerId={null}
        nameFor={nameFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />,
    );
    expect(bubbles()).toHaveLength(0);

    rerender(
      <MessageTimeline
        channelId="chan-1"
        messages={rows}
        viewerId={VIEWER}
        nameFor={nameFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />,
    );

    const [bubble] = bubbles();
    expect(bubble).toBeDefined();
    // §11's self pair and the right tail — never the incoming card fill, which
    // is what the row resolved to before the gate existed.
    expect(bubble?.className).toContain("bg-primary");
    expect(bubble?.className).toContain("rounded-br-[6px]");
    expect(bubble?.className).not.toContain("border-border");
    expect(screen.queryByText("Member 111111")).not.toBeInTheDocument();
  });
});
