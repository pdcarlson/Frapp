/** @vitest-environment jsdom */
/*
  The layering rule, and then the thing it exists for.

  `useChatViewerId` is three lines, and a spec of three lines would be a spec of
  the `??`. What is actually being claimed is a property of the *surface*: that a
  cached `users.id` is enough to paint the member's own history as theirs while
  `GET /v1/users/me` has not answered — and that it is never enough to paint
  somebody else's as theirs. So the second block puts the real `MessageTimeline`
  behind the real hook, with the live id held at `null` throughout, and asserts
  the bubbles.

  That is the bar #2249 sets and the one #2255 must not lose: the gate opens on
  cached identity, and an unknown identity still withholds.
*/
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";

const { liveViewerId } = vi.hoisted(() => ({
  liveViewerId: { current: null as string | null },
}));

/*
  `GET /v1/users/me` as the hooks narrow it. Held at `null` for every test in
  the second block — which is what a warm load looks like before the round trip
  lands, and what an offline load looks like for as long as it stays offline.

  `null` and not a query state on purpose: offline the query either pauses or
  fails depending on whether `onlineManager` saw the `offline` event (see
  `viewer-id.tsx`), and the surface cannot tell those apart. What it gets in
  both is an unresolved id, so that is what these tests hand it.

  `useAuthorAvatars` is stubbed for the same reason `message-timeline.spec.tsx`
  stubs it — it reaches for a `FrappClientProvider` a bare `render()` has not
  mounted.
*/
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useViewerUserId: () => liveViewerId.current,
    useAuthorAvatars: () => ({ data: {} }),
  };
});

/** See `message-timeline.spec.tsx`: jsdom gives Virtuoso nothing to measure. */
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

const { CachedViewerIdProvider, useChatViewerId } = await import("./viewer-id");
const { MessageTimeline } = await import(
  "@/components/chat/message-timeline"
);

/** Same uuids as `message-timeline.spec.tsx`, so the fallback strings match. */
const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";

const nameFor = (id: string) => (id === ALICE ? "Alice Chen" : null);

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: VIEWER,
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

function Probe() {
  return <span data-testid="resolved">{useChatViewerId() ?? "unknown"}</span>;
}

function renderProbe(cached: string | null) {
  return render(
    <CachedViewerIdProvider value={cached}>
      <Probe />
    </CachedViewerIdProvider>,
  );
}

const resolved = () => screen.getByTestId("resolved").textContent;

describe("useChatViewerId", () => {
  it("prefers the live id over the cached one", () => {
    /*
      The cached id is this member's — its key is the auth uid of the session in
      hand — but it is a round trip old, and the one way it goes stale without
      that key changing is an account deleted and recreated under the same uid.
      A resolved live value settles every such case, so it wins outright.
    */
    liveViewerId.current = "live-id";
    renderProbe("stale-cached-id");

    expect(resolved()).toBe("live-id");
  });

  it("serves the cached id while the live one has not arrived", () => {
    liveViewerId.current = null;
    renderProbe(VIEWER);

    expect(resolved()).toBe(VIEWER);
  });

  it("is still unknown when neither half has an answer", () => {
    // The half #2255 must keep. No id means *withhold* — never "not mine".
    liveViewerId.current = null;
    renderProbe(null);

    expect(resolved()).toBe("unknown");
  });

  it("falls back to the live id with no provider above it", () => {
    /*
      Why the context carries the cached half rather than the resolved one. A
      consumer rendered outside `ChatProvider` reads the default — and if that
      default were the whole answer it would have lost the *live* id too, which
      it used to get for free. A misplaced component would then hold a permanent
      skeleton, which is the failure this change exists to remove.
    */
    liveViewerId.current = "live-id";
    render(<Probe />);

    expect(resolved()).toBe("live-id");
  });
});

describe("a warm timeline painted from the cached id alone", () => {
  const bubbles = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-slot="bubble"]'));

  function Timeline({
    cached,
    messages,
  }: {
    cached: string | null;
    messages: ChatMessage[];
  }) {
    return (
      <CachedViewerIdProvider value={cached}>
        <Inner messages={messages} />
      </CachedViewerIdProvider>
    );
  }

  function Inner({ messages }: { messages: ChatMessage[] }) {
    return (
      <MessageTimeline
        channelId="chan-1"
        messages={messages}
        viewerId={useChatViewerId()}
        nameFor={nameFor}
        isLoading={false}
        loadError={null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />
    );
  }

  it("paints the member's own cached history as theirs, with no live identity", () => {
    /*
      **The test #2249 is done by.**

      Every input here is the warm path: rows already in the QueryClient from
      Dexie, `isLoading` false, and `GET /v1/users/me` still unanswered. Before
      this change that combination was a skeleton — `1s` asks the cached tail to
      "render real" and the whole window was shimmer instead. After it, the id
      that came off the same Dexie read attributes the same rows.

      It fails if the cached id stops reaching the timeline, and it fails just as
      loudly if a row that *is* the member's paints as somebody else's: the
      self bubble is right-aligned and avatarless, and `Member 111111` is
      `memberFallbackLabel` reading the viewer's own uuid back to them — the
      literal "Member … · BF" string staging reported on #2243.
    */
    liveViewerId.current = null;

    render(
      <Timeline
        cached={VIEWER}
        messages={[message({ sender_id: VIEWER, content: "mine" })]}
      />,
    );

    expect(screen.getByText("mine")).toBeInTheDocument();
    const [bubble] = bubbles();
    expect(bubble?.className).toContain("rounded-br-[6px]");
    expect(screen.queryByText("Member 111111")).not.toBeInTheDocument();
    expect(screen.queryByText("11")).not.toBeInTheDocument();
  });

  it("still paints another member's row as incoming", () => {
    // The positive half: a gate that opened into *every* row taking the self
    // shape would pass the assertion above. A cached id has to be able to say
    // "not yours" as confidently as it says "yours".
    liveViewerId.current = null;

    render(
      <Timeline
        cached={VIEWER}
        messages={[message({ sender_id: ALICE, content: "from alice" })]}
      />,
    );

    const [bubble] = bubbles();
    expect(bubble?.className).toContain("rounded-bl-[6px]");
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
  });

  it("does not paint one member's history against another member's cached id", () => {
    /*
      The tenancy claim at the surface. `first-chunk-cache.spec.ts` proves no key
      can return Alice's id to Bob; this proves what the id *does* if one ever
      arrived anyway — it attributes by `sender_id`, so a mismatched id makes a
      row incoming, never "mine". Fail-closed, exactly as `message-item.tsx`'s
      `isMine` was rewritten to be in #2255.
    */
    liveViewerId.current = null;

    render(
      <Timeline
        cached={ALICE}
        messages={[message({ sender_id: VIEWER, content: "mine" })]}
      />,
    );

    const [bubble] = bubbles();
    expect(bubble?.className).toContain("rounded-bl-[6px]");
    expect(bubble?.className).not.toContain("rounded-br-[6px]");
  });

  it("withholds every row when neither half knows the viewer", () => {
    // #2255's contract, unchanged: no cached id and no live id is still a
    // skeleton over the rows, not a guess about them.
    liveViewerId.current = null;

    render(
      <Timeline
        cached={null}
        messages={[message({ sender_id: VIEWER, content: "mine" })]}
      />,
    );

    expect(bubbles()).toHaveLength(0);
    expect(screen.queryByText("mine")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading messages");
  });
});
