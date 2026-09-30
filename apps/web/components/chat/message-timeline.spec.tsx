import { StrictMode, createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  HELD_QUOTE_TEXT,
  TOMBSTONE_STALE_TEXT,
  TOMBSTONE_TEXT,
} from "@repo/chat-core/block-copy";
import { reactionActionType, type ChatMessage } from "@repo/chat-core/types";
import { UNAVAILABLE_QUOTE } from "./reply-quote";
import { blockState, timelineBlockProps } from "@/tests/block-list";

/**
 * `react-virtuoso` measures with `ResizeObserver` and renders nothing in jsdom,
 * so the real virtualizer would make every assertion below vacuous. Stubbed to
 * a plain list that renders every item through the same `itemContent` the
 * component passes it — which is the part under test: what `MessageTimeline`
 * hands each row, not how Virtuoso windows them.
 */
// The last props Virtuoso was rendered with, for the older-history cases
// (#1571) that assert what the timeline hands it rather than what it draws.
const virtuosoProps = vi.hoisted(() => ({
  current: {} as {
    firstItemIndex?: number;
    followOutput?: unknown;
    atTopStateChange?: (atTop: boolean) => void;
  },
  // The handle's one method the timeline calls, for the cases that assert
  // where it scrolls.
  scrollToIndex: vi.fn(),
}));

vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  return {
    Virtuoso: React.forwardRef(function Virtuoso(
      {
        data,
        itemContent,
        firstItemIndex,
        followOutput,
        atTopStateChange,
        components,
        context,
      }: {
        data: unknown[];
        itemContent: (index: number, item: unknown) => React.ReactNode;
        firstItemIndex?: number;
        followOutput?: unknown;
        atTopStateChange?: (atTop: boolean) => void;
        components?: {
          Header?: (props: { context?: unknown }) => React.ReactNode;
        };
        context?: unknown;
      },
      ref: React.Ref<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: virtuosoProps.scrollToIndex,
      }));
      virtuosoProps.current = {
        firstItemIndex,
        followOutput,
        atTopStateChange,
      };
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

// Imported authors' signed Discord avatars, by stored path. Empty unless a
// case sets it.
const authorAvatars = vi.hoisted(() => ({
  data: {} as Record<string, string>,
}));

// `useAuthorAvatars` reaches for `FrappClientProvider`, which a bare `render()`
// does not mount.
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuthorAvatars: () => ({ data: authorAvatars.data }),
    // Only a message with `attachment_count > 0` mounts the list that reads
    // this; the image viewer cases below are the ones that do.
    useMessageAttachments: () => ({
      isPending: false,
      isError: false,
      data: [
        {
          id: "att-1",
          message_id: "m1",
          filename: "photo.png",
          content_type: "image/png",
          byte_size: 2048,
          width: null,
          height: null,
          download_url: "https://storage.test/signed/photo.png",
        },
      ],
    }),
  };
});

// Radix's `AvatarImage` mounts its `<img>` only after the browser loads it,
// which jsdom never does, so the photo a row was handed would be invisible.
// Stood in by a marker carrying the `src`, beside the real fallback.
vi.mock("@/components/ui/avatar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AvatarImage: ({ src }: { src?: string }) => (
      <span data-testid="avatar-photo" data-src={src} />
    ),
  };
});

const { MessageTimeline } = await import("./message-timeline");
type MessageTimelineHandle = import("./message-timeline").MessageTimelineHandle;

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

const nameFor = (id: string) =>
  id === ALICE ? "Alice Chen" : id === BOB ? "Bob Ruiz" : null;
const avatarFor = (): string | null => null;

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
      avatarFor={avatarFor}
      isLoading={false}
      loadError={null}
      onReact={vi.fn()}
      onUnreact={vi.fn()}
      {...timelineBlockProps(messages, VIEWER)}
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
    // Twice: the parent's own body, and the preview inside the reply's quote.
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

    const rows = container.querySelectorAll(".px-5.pb-0\\.5");
    expect(rows.length).toBeGreaterThan(0);
    // The metrics `MessageItem` draws: 32px avatar gutter, 12px gap, and the
    // run-start/follow-on padding pair. A skeleton that drifts from these
    // moves the first real row by the difference.
    for (const row of rows) {
      expect(row.className).toContain("gap-3");
      expect(row.className).toMatch(/\bpt-4\b|\bpt-0\.5\b/);
      expect(row.querySelector(".w-8")).not.toBeNull();
    }
  });

  it("reserves the body's 25px line box, not a bare bar", () => {
    /*
      The height lives in the body. A compact row's text is one 25px line box
      (the `body` role), so each placeholder row reserves exactly that under
      its bar, plus a 20px author line on a row that starts a run. jsdom
      computes no layout, so nothing measurable goes red; the durable check is
      that the placeholder is built from the same box declarations as the
      thing it replaces. (Under the §11 bubble this was a 55px bordered box.)
    */
    const { container } = renderTimeline([], { isLoading: true });
    const rows = [...container.querySelectorAll(".px-5.pb-0\\.5")];

    for (const row of rows) {
      expect(row.querySelector(".h-\\[25px\\]")).not.toBeNull();
      expect(row.querySelector(".border")).toBeNull();
      const startsRun = row.className.includes("pt-4");
      expect(row.querySelector(".h-5") !== null).toBe(startsRun);
    }
  });

  it("draws both run-start and follow-on rows, as a real channel does", () => {
    // A run of same-author messages is most of a channel, and a follow-on row
    // has no avatar and no author line. An all-headed skeleton would reserve more
    // height than the rows that replace it.
    const { container } = renderTimeline([], { isLoading: true });

    const rows = [...container.querySelectorAll(".px-5.pb-0\\.5")];
    expect(rows.some((r) => r.className.includes("pt-4"))).toBe(true);
    expect(rows.some((r) => r.className.includes("pt-0.5"))).toBe(true);
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
 * `viewerId` decides whose message a row is (the "You" author line in the
 * chapter accent, and Edit and Delete), and it arrives on its own clock — `GET /v1/users/me`, which the first
 * chunk's Dexie read (#2227) regularly beats. It used to arrive as `null` into a
 * row that treated `null` as "not mine", so on staging the signed-in member's
 * own messages painted as a stranger's: left, incoming chrome, and labelled with
 * the first six hex of their own uuid because `resolveAuthorLabel` had skipped
 * its "You" branch.
 *
 * These assert the *absence* of that paint rather than the presence of a
 * skeleton, because the skeleton is the current answer and not the requirement.
 * Anything that draws a row before identity lands has to guess whose it is,
 * and the bug is the guess.
 */
describe("MessageTimeline identity gate (#2243)", () => {
  const bodies = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="message-body"]'),
    );

  it("paints no row at all while the viewer is unknown", () => {
    renderTimeline([message({ sender_id: VIEWER, content: "mine" })], {
      viewerId: null,
    });

    // The whole of the fix: a row the member wrote is not drawn as somebody
    // else's, and the way it is not drawn as somebody else's is that it is not
    // drawn yet.
    expect(bodies()).toHaveLength(0);
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

  it("still paints another member's row as theirs once identity settles", () => {
    // The positive half, and not implied by the own-row case: a gate that opened
    // into *every* row reading as the viewer's would pass every assertion above.
    renderTimeline([message({ sender_id: ALICE, content: "from alice" })], {
      viewerId: VIEWER,
    });

    expect(bodies()).toHaveLength(1);
    const name = screen.getByText("Alice Chen");
    expect(name.className).not.toContain("text-accent-text");
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("withholds an incoming row too, not just the member's own", () => {
    // Not an over-reach: while the viewer is unknown *any* row could be theirs,
    // so there is no subset that is safe to draw early. Asserted so a later
    // optimisation cannot narrow the gate to "own rows only" — which is
    // undecidable at exactly the moment it would have to decide.
    renderTimeline([message({ sender_id: ALICE, content: "from alice" })], {
      viewerId: null,
    });

    expect(bodies()).toHaveLength(0);
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
        {...timelineBlockProps(rows, null)}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />,
    );
    expect(bodies()).toHaveLength(0);

    rerender(
      <MessageTimeline
        channelId="chan-1"
        messages={rows}
        viewerId={VIEWER}
        {...timelineBlockProps(rows, VIEWER)}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />,
    );

    expect(bodies()).toHaveLength(1);
    // "You" in the chapter accent — never the viewer's own uuid read back to
    // them as a stranger's name, which is what the row resolved to before the
    // gate existed.
    expect(screen.getByText("You").className).toContain("text-accent-text");
    expect(screen.queryByText("Member 111111")).not.toBeInTheDocument();
  });
});

/**
 * The viewer's block list (#2313). `message()` builds a row with no provenance
 * — what the Realtime echo delivers — unless a case marks it as a REST row the
 * server evaluated (`_blockEvaluated`).
 */
describe("MessageTimeline — the viewer's block list (#2313)", () => {
  /** What the API's masker writes today — used only to prove nothing reads it. */
  const SERVER_SENTINEL = "[message from a blocked member]";

  function renderWithList(
    messages: ChatMessage[],
    state: ReturnType<typeof blockState>,
    overrides: Record<string, unknown> = {},
  ) {
    return renderTimeline(messages, {
      ...timelineBlockProps(messages, VIEWER, state),
      ...overrides,
    });
  }

  it("tombstones a blocked member's live message, with nothing they wrote", () => {
    renderWithList(
      [message({ id: "m1", content: "you are pathetic", attachment_count: 2 })],
      blockState("ready", { ids: [ALICE] }),
    );

    expect(screen.getByText(TOMBSTONE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText("you are pathetic")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
    // No attachment list mounts, so nothing fetches the blocked member's files.
    expect(screen.queryByText(/attachment/i)).not.toBeInTheDocument();
  });

  it("tombstones a server-masked row whatever the list says, without reading its body", () => {
    renderWithList(
      [
        message({
          id: "m1",
          content: SERVER_SENTINEL,
          sender_blocked: true,
          _blockEvaluated: true,
        }),
      ],
      blockState("unavailable"),
    );

    expect(screen.getByText(TOMBSTONE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(SERVER_SENTINEL)).not.toBeInTheDocument();
  });

  it("tombstones a blocked member's poll rather than drawing a votable card", () => {
    renderWithList(
      [
        message({
          id: "m1",
          kind: "poll",
          content: "Who is the worst?",
          payload: { question: "Who is the worst?", options: ["You"] },
        }),
      ],
      blockState("ready", { ids: [ALICE] }),
    );

    expect(screen.getByText(TOMBSTONE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText("Who is the worst?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /vote/i })).toBeNull();
  });

  it("offers Unblock for the sender, and nothing else", async () => {
    const onUnblock = vi.fn();
    renderWithList(
      [message({ id: "m1" })],
      blockState("ready", { ids: [ALICE] }),
      { onUnblock },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Unblock Alice Chen" }),
    );
    expect(onUnblock).toHaveBeenCalledWith(ALICE);
    expect(screen.queryByRole("group", { name: "Message actions" })).toBeNull();
  });

  it("offers Reload, not Unblock, on a masked copy whose post-unblock re-read failed", async () => {
    const onReloadMasked = vi.fn();
    renderWithList(
      [
        message({
          id: "m1",
          content: SERVER_SENTINEL,
          sender_blocked: true,
          _blockEvaluated: true,
        }),
      ],
      blockState("ready", { unblocked: [ALICE] }),
      { onReloadMasked, maskedRefresh: new Map([[ALICE, "failed"]]) },
    );

    expect(screen.getByText(TOMBSTONE_STALE_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^unblock/i })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Reload hidden messages from Alice Chen",
      }),
    );
    expect(onReloadMasked).toHaveBeenCalledWith(ALICE);
  });

  it("holds a live row the list cannot vouch for, and does not call the channel empty", () => {
    renderWithList(
      [message({ id: "m1", sender_id: BOB, content: "from the echo" })],
      blockState("unavailable"),
    );

    expect(screen.queryByText("from the echo")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Nothing in this channel yet"),
    ).not.toBeInTheDocument();
  });

  it("still shows the viewer's own message and a server-cleared row while the list is unavailable", () => {
    renderWithList(
      [
        message({ id: "m1", sender_id: VIEWER, content: "mine" }),
        message({
          id: "m2",
          sender_id: BOB,
          content: "read over REST",
          sender_blocked: false,
          _blockEvaluated: true,
        }),
      ],
      blockState("unavailable"),
    );

    expect(screen.getByText("mine")).toBeInTheDocument();
    expect(screen.getByText("read over REST")).toBeInTheDocument();
  });

  it("quotes a blocked member's parent as the tombstone's words, on the live path", () => {
    renderWithList(
      [
        message({ id: "p1", content: "the insult" }),
        message({
          id: "r1",
          sender_id: BOB,
          content: "a reply",
          reply_to_id: "p1",
        }),
      ],
      blockState("ready", { ids: [ALICE] }),
    );

    expect(screen.getByText("a reply")).toBeInTheDocument();
    expect(screen.queryByText("the insult")).not.toBeInTheDocument();
    // Once for the parent's own row, once in the reply's quote.
    expect(screen.getAllByText(TOMBSTONE_TEXT)).toHaveLength(2);
  });

  it("quotes a held parent as hidden, not as not loaded", () => {
    renderWithList(
      [
        message({ id: "p1", content: "unvouched" }),
        message({
          id: "r1",
          sender_id: VIEWER,
          content: "my reply",
          reply_to_id: "p1",
        }),
      ],
      blockState("loading"),
    );

    expect(screen.getByText(HELD_QUOTE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText("unvouched")).not.toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE_QUOTE)).not.toBeInTheDocument();
  });

  it("drops a blocked member's reaction from the chip on someone else's message", () => {
    const thumbs = reactionActionType("👍");
    const insult = reactionActionType("you suck");
    renderWithList(
      [
        message({
          id: "m1",
          sender_id: BOB,
          reactions: { [thumbs]: [ALICE, VIEWER], [insult]: [ALICE] },
        }),
      ],
      blockState("ready", { ids: [ALICE] }),
    );

    expect(
      screen.getByRole("button", { name: /^👍 reaction, 1, including you/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("you suck")).not.toBeInTheDocument();
  });

  it("never matches the server's sentinel string to decide anything", () => {
    // A live row whose body happens to read like the sentinel, from someone
    // the viewer has not blocked, is an ordinary message.
    renderWithList(
      [message({ id: "m1", sender_id: BOB, content: SERVER_SENTINEL })],
      blockState("ready"),
    );

    expect(screen.getByText(SERVER_SENTINEL)).toBeInTheDocument();
    expect(screen.queryByText(TOMBSTONE_TEXT)).not.toBeInTheDocument();
  });
});

/**
 * #1571 — older history. The timeline asks for the next page while the member
 * sits at the top, and lowers `firstItemIndex` by what a page prepends so
 * Virtuoso keeps the rows on screen where they were.
 */
describe("MessageTimeline older history (#1571)", () => {
  function history(from: number, to: number): ChatMessage[] {
    const rows: ChatMessage[] = [];
    for (let n = from; n <= to; n += 1) {
      rows.push(
        message({
          id: `msg-${n}`,
          client_message_id: `cm-${n}`,
          content: `message ${n}`,
          created_at: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
        }),
      );
    }
    return rows;
  }

  it("lowers firstItemIndex by the rows a page prepends, and not for an append", () => {
    const { rerender } = renderTimeline(history(11, 20));
    const start = virtuosoProps.current.firstItemIndex!;

    const prepended = history(1, 20);
    rerender(
      <MessageTimeline
        channelId="chan-1"
        messages={prepended}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(prepended, VIEWER)}
      />,
    );
    expect(virtuosoProps.current.firstItemIndex).toBe(start - 10);

    const appended = history(1, 21);
    rerender(
      <MessageTimeline
        channelId="chan-1"
        messages={appended}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(appended, VIEWER)}
      />,
    );
    expect(virtuosoProps.current.firstItemIndex).toBe(start - 10);
  });

  /** The list settles onto its bottom, then the member scrolls to the top. */
  function scrollToTop() {
    act(() => virtuosoProps.current.atTopStateChange?.(false));
    act(() => virtuosoProps.current.atTopStateChange?.(true));
  }

  it("raises firstItemIndex by the rows that leave the top", () => {
    // A refetch returns the thread to its newest page, dropping the oldest
    // rows; the index has to rise with them, or Virtuoso reads the shrink as
    // rows lost at the end.
    const view = (messages: ChatMessage[]) => (
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(messages, VIEWER)}
      />
    );
    const { rerender } = render(view(history(1, 20)));
    const start = virtuosoProps.current.firstItemIndex!;

    rerender(view(history(6, 20)));

    expect(virtuosoProps.current.firstItemIndex).toBe(start + 5);
  });

  it("asks for older history once the member scrolls to the top", () => {
    const onLoadOlder = vi.fn();
    renderTimeline(history(1, 5), { hasOlder: true, onLoadOlder });
    expect(onLoadOlder).not.toHaveBeenCalled();

    scrollToTop();

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("opens a cached channel at its newest row, as a mount would", () => {
    const view = (channelId: string) => (
      <MessageTimeline
        channelId={channelId}
        messages={history(1, 5)}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(history(1, 5), VIEWER)}
      />
    );
    const { rerender } = render(view("chan-1"));
    virtuosoProps.scrollToIndex.mockClear();

    rerender(view("chan-2"));

    expect(virtuosoProps.scrollToIndex).toHaveBeenCalledWith({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  });

  it("opens at the newest row even when the switch carries a jump", () => {
    // The shell's jump scroll runs after this in the same commit and replaces
    // it; a jump that settles on a notice leaves the list here, at the newest
    // row, not at the last channel's offset.
    const view = (channelId: string) => (
      <MessageTimeline
        channelId={channelId}
        messages={history(1, 5)}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        holdFollow={channelId === "chan-2"}
        {...timelineBlockProps(history(1, 5), VIEWER)}
      />
    );
    const { rerender } = render(view("chan-1"));
    virtuosoProps.scrollToIndex.mockClear();

    rerender(view("chan-2"));

    expect(virtuosoProps.scrollToIndex).toHaveBeenCalledWith({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  });

  it("reads no older page for a channel switched to from the list's top", () => {
    const onLoadOlder = vi.fn();
    const view = (channelId: string, hasOlder: boolean) => (
      <MessageTimeline
        channelId={channelId}
        messages={history(1, 5)}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        hasOlder={hasOlder}
        onLoadOlder={onLoadOlder}
        {...timelineBlockProps(history(1, 5), VIEWER)}
      />
    );
    // At the top of a channel whose history has run out.
    const { rerender } = render(view("chan-1", false));
    act(() => virtuosoProps.current.atTopStateChange?.(false));
    act(() => virtuosoProps.current.atTopStateChange?.(true));

    rerender(view("chan-2", true));
    expect(onLoadOlder).not.toHaveBeenCalled();

    // The switch's scroll to the newest row moves it off the top, which arms
    // it; the member scrolling back up then reads a page.
    act(() => virtuosoProps.current.atTopStateChange?.(false));
    act(() => virtuosoProps.current.atTopStateChange?.(true));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("does not take Strict Mode's second pass over a mount for a switch", () => {
    const onLoadOlder = vi.fn();
    virtuosoProps.scrollToIndex.mockClear();
    render(
      <StrictMode>
        <MessageTimeline
          channelId="chan-1"
          messages={history(1, 5)}
          viewerId={VIEWER}
          nameFor={nameFor}
          avatarFor={avatarFor}
          isLoading={false}
          loadError={null}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          hasOlder
          onLoadOlder={onLoadOlder}
          {...timelineBlockProps(history(1, 5), VIEWER)}
        />
      </StrictMode>,
    );

    act(() => virtuosoProps.current.atTopStateChange?.(true));

    expect(virtuosoProps.scrollToIndex).not.toHaveBeenCalled();
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("does not arm a channel whose list mounts fresh on the switch", () => {
    // Out of a channel that drew no list: the new list is a fresh mount, which
    // reports "at the top" before it scrolls to its newest row.
    const onLoadOlder = vi.fn();
    const view = (channelId: string, messages: ChatMessage[]) => (
      <MessageTimeline
        channelId={channelId}
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        hasOlder
        onLoadOlder={onLoadOlder}
        {...timelineBlockProps(messages, VIEWER)}
      />
    );
    const { rerender } = render(view("chan-1", []));

    rerender(view("chan-2", history(1, 5)));
    act(() => virtuosoProps.current.atTopStateChange?.(true));

    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("jumps with an instant scroll, which re-aims until the rows settle", () => {
    const ref = createRef<MessageTimelineHandle>();
    render(
      <MessageTimeline
        ref={ref}
        channelId="chan-1"
        messages={history(1, 5)}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(history(1, 5), VIEWER)}
      />,
    );
    virtuosoProps.scrollToIndex.mockClear();

    expect(ref.current?.scrollToMessage("msg-3")).toBe(true);
    expect(virtuosoProps.scrollToIndex).toHaveBeenCalledWith({
      index: 2,
      align: "center",
      behavior: "auto",
    });
  });

  it("arms the next channel on a switch while the list is not at its top", () => {
    // A cached channel keeps the list mounted, so no "left the top" arrives
    // for it; the switch itself has to arm it.
    const onLoadOlder = vi.fn();
    const view = (channelId: string) => (
      <MessageTimeline
        channelId={channelId}
        messages={history(1, 5)}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        hasOlder
        onLoadOlder={onLoadOlder}
        {...timelineBlockProps(history(1, 5), VIEWER)}
      />
    );
    const { rerender } = render(view("chan-1"));
    act(() => virtuosoProps.current.atTopStateChange?.(false));

    rerender(view("chan-2"));
    act(() => virtuosoProps.current.atTopStateChange?.(true));

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("asks again when a refetch drops the page it just loaded", () => {
    const onLoadOlder = vi.fn();
    const view = (messages: ChatMessage[]) => (
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        hasOlder
        onLoadOlder={onLoadOlder}
        {...timelineBlockProps(messages, VIEWER)}
      />
    );
    const { rerender } = render(view(history(11, 20)));
    scrollToTop();
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // The page lands, then a refetch returns the thread to its newest rows,
    // dropping it and the row that was first when the member asked.
    rerender(view(history(1, 20)));
    rerender(view(history(15, 20)));

    expect(onLoadOlder).toHaveBeenCalledTimes(2);
  });

  it("ignores the moment at the top every open passes through", () => {
    // Virtuoso renders from the top before it scrolls to the newest row, so
    // "at the top" arrives before the list has ever left it.
    const onLoadOlder = vi.fn();
    renderTimeline(history(1, 5), { hasOlder: true, onLoadOlder });

    act(() => virtuosoProps.current.atTopStateChange?.(true));

    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("asks for one page per arrival at the top, not again as it lands", () => {
    const onLoadOlder = vi.fn();
    const props = (messages: ChatMessage[], isLoadingOlder: boolean) => (
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        hasOlder
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={onLoadOlder}
        {...timelineBlockProps(messages, VIEWER)}
      />
    );
    const { rerender } = render(props(history(11, 20), false));
    scrollToTop();
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // The page is in flight, then lands above the rows. Virtuoso has not yet
    // reported leaving the top, which is when a second page used to follow.
    rerender(props(history(11, 20), true));
    rerender(props(history(1, 20), false));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // The member scrolls up to the new top: the next page.
    scrollToTop();
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
  });

  it("asks for nothing once the channel's start is loaded", () => {
    const onLoadOlder = vi.fn();
    renderTimeline(history(1, 5), { hasOlder: false, onLoadOlder });

    scrollToTop();

    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("does not follow a prepend to the bottom once the list has settled", () => {
    // Followed, a page landing while the member sat at the bottom snapped the
    // list back there, half a second after a jump had scrolled to the message
    // the page was loaded for.
    const view = (messages: ChatMessage[]) => (
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(messages, VIEWER)}
      />
    );
    const { rerender } = render(view(history(11, 20)));
    act(() => virtuosoProps.current.atTopStateChange?.(false));

    rerender(view(history(1, 20)));
    expect(virtuosoProps.current.followOutput).toBe(false);

    // A new message at the end is followed as ever.
    rerender(view(history(1, 21)));
    expect(virtuosoProps.current.followOutput).toBe("smooth");
  });

  it("still follows while a cold open settles onto its newest row", () => {
    // The live page landing over the cached tail prepends rows before the list
    // has left its top; following those is what keeps the open at the bottom.
    const view = (messages: ChatMessage[]) => (
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(messages, VIEWER)}
      />
    );
    const { rerender } = render(view(history(11, 20)));

    rerender(view(history(1, 20)));

    expect(virtuosoProps.current.followOutput).toBe("smooth");
  });

  it("does not follow a growing list while a jump is on its way", () => {
    const view = (messages: ChatMessage[], holdFollow: boolean) => (
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        holdFollow={holdFollow}
        {...timelineBlockProps(messages, VIEWER)}
      />
    );
    const { rerender } = render(view(history(1, 5), true));
    expect(virtuosoProps.current.followOutput).toBe(false);

    rerender(view(history(1, 6), false));
    expect(virtuosoProps.current.followOutput).toBe("smooth");
  });

  it("says a page is loading above the oldest row", () => {
    renderTimeline(history(1, 5), { hasOlder: true, isLoadingOlder: true });

    expect(
      screen
        .getAllByRole("status")
        .some((node) => node.textContent === "Loading earlier messages..."),
    ).toBe(true);
  });

  it("stops asking after a failure and offers Retry instead", async () => {
    const onLoadOlder = vi.fn();
    renderTimeline(history(1, 5), {
      hasOlder: true,
      olderError: true,
      onLoadOlder,
    });

    scrollToTop();
    expect(onLoadOlder).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load earlier messages.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});

describe("MessageTimeline — member photos (#732)", () => {
  it("draws a member's photo from the roster beside their message", () => {
    renderTimeline([message({ id: "m-1", sender_id: ALICE })], {
      avatarFor: (id: string) => (id === ALICE ? "https://signed/alice" : null),
    });

    expect(screen.getByTestId("avatar-photo").getAttribute("data-src")).toBe(
      "https://signed/alice",
    );
  });

  it("keeps initials for a member with no photo", () => {
    renderTimeline([message({ id: "m-1", sender_id: BOB })], {
      avatarFor: (id: string) => (id === ALICE ? "https://signed/alice" : null),
    });

    expect(screen.queryByTestId("avatar-photo")).toBeNull();
  });

  describe("beside imported Discord messages", () => {
    beforeEach(() => {
      authorAvatars.data = { "archive/p.png": "https://signed/discord" };
    });
    afterEach(() => {
      authorAvatars.data = {};
    });

    it("draws an unlinked author's Discord avatar (#1231)", () => {
      renderTimeline([
        message({
          id: "m-1",
          sender_id: null,
          author_name: "old-handle",
          author_avatar_path: "archive/p.png",
        }),
      ]);

      expect(screen.getByTestId("avatar-photo").getAttribute("data-src")).toBe(
        "https://signed/discord",
      );
    });

    it("never draws it on a linked row, even when the member has no photo (#2878)", () => {
      // The signed batch can hold the path because an unlinked row in the
      // same window shares it.
      renderTimeline(
        [
          message({
            id: "m-1",
            sender_id: BOB,
            author_avatar_path: "archive/p.png",
          }),
        ],
        { avatarFor: () => null },
      );

      expect(screen.queryByTestId("avatar-photo")).toBeNull();
    });
  });
});

/**
 * Runs and day dividers, drawn (`components.md` §11 § Grouping, #2873). The
 * rules themselves are `@repo/chat-core/grouping`'s and are pinned there; this
 * pins that the timeline draws what they decide.
 */
describe("MessageTimeline runs and day dividers (#2873)", () => {
  const rowOf = (text: string) =>
    screen.getByText(text).closest<HTMLElement>('[role="listitem"]')!;

  it("draws one author line per run, and none on its follow-ons", () => {
    renderTimeline([
      message({ id: "a", client_message_id: "a", content: "one" }),
      message({
        id: "b",
        client_message_id: "b",
        content: "two",
        created_at: new Date(2026, 7, 16, 17, 10).toISOString(),
      }),
      message({
        id: "c",
        client_message_id: "c",
        sender_id: BOB,
        content: "three",
        created_at: new Date(2026, 7, 16, 17, 11).toISOString(),
      }),
    ]);

    expect(rowOf("one").dataset.run).toBe("start");
    expect(rowOf("two").dataset.run).toBe("follow");
    expect(rowOf("three").dataset.run).toBe("start");
    expect(screen.getAllByText("Alice Chen")).toHaveLength(1);
  });

  it("starts a new run after the window, and on a reply", () => {
    renderTimeline([
      message({ id: "a", client_message_id: "a", content: "one" }),
      message({
        id: "b",
        client_message_id: "b",
        content: "later",
        created_at: new Date(2026, 7, 16, 17, 20).toISOString(),
      }),
      message({
        id: "c",
        client_message_id: "c",
        content: "answer",
        reply_to_id: "a",
        created_at: new Date(2026, 7, 16, 17, 21).toISOString(),
      }),
    ]);

    expect(rowOf("later").dataset.run).toBe("start");
    expect(rowOf("answer").dataset.run).toBe("start");
  });

  it("draws a day divider where a day starts, and restarts the run under it", () => {
    const { container } = renderTimeline([
      message({
        id: "a",
        client_message_id: "a",
        content: "late",
        created_at: new Date(2026, 7, 16, 23, 59).toISOString(),
      }),
      message({
        id: "b",
        client_message_id: "b",
        content: "early",
        created_at: new Date(2026, 7, 17, 0, 1).toISOString(),
      }),
    ]);

    const dividers = container.querySelectorAll('[data-slot="day-divider"]');
    expect(dividers).toHaveLength(2);
    // The only date in the thread: no author line carries one.
    for (const divider of dividers) {
      expect(divider.textContent).toMatch(/16|17/);
    }
    expect(rowOf("early").dataset.run).toBe("start");
  });

  it("draws one divider for a day's messages, not one per message", () => {
    const { container } = renderTimeline([
      message({ id: "a", client_message_id: "a", content: "one" }),
      message({
        id: "b",
        client_message_id: "b",
        sender_id: BOB,
        content: "two",
        created_at: new Date(2026, 7, 16, 17, 30).toISOString(),
      }),
      message({
        id: "c",
        client_message_id: "c",
        content: "three",
        created_at: new Date(2026, 7, 16, 21, 0).toISOString(),
      }),
    ]);
    expect(container.querySelectorAll('[data-slot="day-divider"]')).toHaveLength(
      1,
    );
  });

  it("hands every follow-on the start of its run, not the row above", () => {
    // Three rows: noon falls between the first and the second, so the third
    // is only read correctly against the run's start (11:58 AM), not against
    // the row above it (12:01 PM, same period as itself).
    renderTimeline([
      message({
        id: "a",
        client_message_id: "a",
        content: "before noon",
        created_at: new Date(2026, 7, 16, 11, 58).toISOString(),
      }),
      message({
        id: "b",
        client_message_id: "b",
        content: "after noon",
        created_at: new Date(2026, 7, 16, 12, 1).toISOString(),
      }),
      message({
        id: "c",
        client_message_id: "c",
        content: "later still",
        created_at: new Date(2026, 7, 16, 12, 4).toISOString(),
      }),
    ]);
    for (const [text, minute] of [
      ["after noon", 1],
      ["later still", 4],
    ] as const) {
      const gutter = rowOf(text).querySelector('[data-slot="gutter-time"]');
      expect(gutter?.textContent, text).toBe(
        new Date(2026, 7, 16, 12, minute).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    }
  });

  it("puts no date on any author line", () => {
    const { container } = renderTimeline([message()]);
    const line = container.querySelector('[data-slot="author-line"]');
    expect(line?.textContent).not.toMatch(/Aug|16,/);
  });
});

/**
 * #2874: the timeline hosts the image viewer above its virtualized rows, so
 * it has to close the viewer itself when the message it shows stops being
 * drawn in full; the row that opened it may not be mounted to do it.
 */
describe("the image viewer", () => {
  const withPhoto = (overrides: Partial<ChatMessage> = {}) =>
    message({ id: "m1", attachment_count: 1, ...overrides });

  async function openViewer() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View photo.png" }));
    return screen.findByRole("dialog");
  }

  it("opens from a message's image", async () => {
    renderTimeline([withPhoto()]);
    const dialog = await openViewer();
    expect(dialog).toHaveAccessibleName("photo.png");
  });

  it("closes when the message is deleted", async () => {
    const view = renderTimeline([withPhoto()]);
    await openViewer();

    const deleted = [withPhoto({ is_deleted: true })];
    view.rerender(
      <MessageTimeline
        channelId="chan-1"
        messages={deleted}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(deleted, VIEWER)}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the sender is blocked and the message becomes a tombstone", async () => {
    const messages = [withPhoto()];
    const view = renderTimeline(messages);
    await openViewer();

    view.rerender(
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={VIEWER}
        nameFor={nameFor}
        avatarFor={avatarFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        {...timelineBlockProps(
          messages,
          VIEWER,
          blockState("ready", { ids: [ALICE] }),
        )}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
