import { render, screen } from "@testing-library/react";
import type { AskAccess } from "@repo/validation";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@Frapp` in a channel, answered to the asker alone (#4713): what a channel
 * asks with, which turns it draws, and how one reads.
 */

const state = vi.hoisted(() => ({
  ask: vi.fn(),
  retry: vi.fn(),
  dismiss: vi.fn(),
  consent: vi.fn(),
  // One identity each, as the conversation's own actions have.
  setProposal: vi.fn(),
  resolveProposal: vi.fn(),
  exchanges: [] as unknown[],
  permissions: ["ai:use"] as string[],
  // The post steps (`useAskPostFlow`, tested in `@repo/hooks`): where the
  // asker is, and what the row handed the hook.
  post: {
    stage: "idle" as string,
    restricted: [] as { key: string; kind: string; title: string }[],
    changed: false,
    error: null as string | null,
    start: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
  },
  posting: [] as {
    channelId: string;
    answer: unknown;
    onPosted: () => void;
  }[],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAsk: () => ({
    exchanges: state.exchanges,
    working: state.exchanges.some(
      (exchange) => (exchange as { phase: string }).phase === "working",
    ),
    ask: state.ask,
    retry: state.retry,
    setProposal: state.setProposal,
    resolveProposal: state.resolveProposal,
    dismissFromChannel: state.dismiss,
    stop: vi.fn(),
    reset: vi.fn(),
  }),
  useMyPermissions: () => ({ data: { permissions: state.permissions } }),
  useAskPostFlow: (input: (typeof state.posting)[number]) => {
    state.posting.push(input);
    return state.post;
  },
}));

vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({
    ensureConsent: state.consent,
    consentDialog: <div data-testid="consent-dialog" />,
  }),
}));

const {
  AskChannelTurn,
  AskInChannelBridge,
  useChannelAsk,
  useChannelAskAccess,
  useChannelAskTurns,
  useSharedAskCardEdits,
} = await import("./ask-in-channel");

const DONE = {
  id: "turn-1",
  question: "When is the budget vote?",
  phase: "done",
  step: null,
  preview: "",
  failure: null,
  proposal: null,
  resolution: null,
  origin: {
    channelId: "chan-1",
    at: "2026-11-13T16:00:00.000Z",
    after: "c9",
  },
  answer: {
    status: "answered",
    reason: null,
    text: "The budget vote is in the minutes.",
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  },
};

/** Called each time the channel's own reader draws. */
const drew = vi.fn();

/** What a channel's composer and timeline read, drawn so a test can too. */
function Channel({ channelId = "chan-1" }: { channelId?: string }) {
  const ask = useChannelAsk();
  const access = useChannelAskAccess();
  const turns = useChannelAskTurns(channelId);
  const edits = useSharedAskCardEdits();
  drew();
  return (
    <div>
      <p data-testid="ask">{ask ? (ask.busy ? "busy" : "ready") : "none"}</p>
      <p data-testid="access">{access}</p>
      <p data-testid="edits">{edits ? "shared" : "none"}</p>
      <button
        type="button"
        onClick={() => ask?.send(channelId, "when is formal?", "c9")}
      >
        send
      </button>
      {turns.map((turn) => (
        <AskChannelTurn key={turn.id} id={turn.id} />
      ))}
    </div>
  );
}

const tree = (access: AskAccess, channelId?: string) => (
  <AskInChannelBridge access={access}>
    <Channel channelId={channelId} />
  </AskInChannelBridge>
);
const mount = (enabled = true, channelId?: string) =>
  render(tree(enabled ? "yes" : "no", channelId));

beforeEach(() => {
  state.ask.mockReset().mockResolvedValue(undefined);
  state.retry.mockReset().mockResolvedValue(undefined);
  state.dismiss.mockReset();
  state.consent.mockReset().mockResolvedValue(true);
  state.exchanges = [];
  state.permissions = ["ai:use"];
  Object.assign(state.post, {
    stage: "idle",
    restricted: [],
    changed: false,
    error: null,
  });
  state.post.start.mockReset();
  state.post.confirm.mockReset();
  state.post.cancel.mockReset();
  state.posting = [];
  drew.mockClear();
});

describe("asking from a channel", () => {
  it("gives a member without Ask nothing: no way to ask, no turns, no Meet Frapp AI", async () => {
    state.exchanges = [DONE];
    mount(false);
    expect(screen.getByTestId("ask")).toHaveTextContent("none");
    expect(screen.getByTestId("access")).toHaveTextContent("no");
    expect(screen.getByTestId("edits")).toHaveTextContent("none");
    expect(document.querySelector("[data-ask-channel-turn]")).toBeNull();
    expect(screen.queryByTestId("consent-dialog")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "send" }));
    expect(state.ask).not.toHaveBeenCalled();
  });

  it("offers nothing while Ask is not yet known, and says that it is not known", async () => {
    // The composer holds a message naming `@Frapp` on this answer, so it
    // must be told apart from a member who has no Ask.
    state.exchanges = [DONE];
    render(tree("unknown"));
    expect(screen.getByTestId("ask")).toHaveTextContent("none");
    expect(screen.getByTestId("access")).toHaveTextContent("unknown");
    expect(document.querySelector("[data-ask-channel-turn]")).toBeNull();
    expect(screen.queryByTestId("consent-dialog")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "send" }));
    expect(state.ask).not.toHaveBeenCalled();
  });

  it("reads as no Ask outside the bridge", () => {
    render(<Channel />);
    expect(screen.getByTestId("access")).toHaveTextContent("no");
    expect(screen.getByTestId("ask")).toHaveTextContent("none");
  });

  it("asks with the channel and the message it was asked under, behind the consent gate", async () => {
    mount();
    expect(screen.getByTestId("consent-dialog")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "send" }));
    expect(state.ask).toHaveBeenCalledWith("when is formal?", {
      actions: false,
      gate: state.consent,
      channelId: "chan-1",
      afterMessage: "c9",
    });
  });

  it("never says the saved notice was shown, so nothing from a channel is kept (#4315)", async () => {
    mount();
    await userEvent.setup().click(screen.getByRole("button", { name: "send" }));
    expect(state.ask.mock.calls[0]![1]).not.toHaveProperty("savedNoticeShown");
  });

  it("lets Frapp propose only for a member who may have it act", async () => {
    state.permissions = ["ai:use", "ai:act"];
    mount();
    await userEvent.setup().click(screen.getByRole("button", { name: "send" }));
    expect(state.ask.mock.calls[0]![1]).toMatchObject({ actions: true });
  });

  it("says a question is still being answered", () => {
    state.exchanges = [{ ...DONE, phase: "working", answer: null }];
    mount();
    expect(screen.getByTestId("ask")).toHaveTextContent("busy");
  });
});

describe("the turns a channel draws", () => {
  it("draws the ones asked in it, not another channel's, the card's own or a dismissed one", () => {
    state.exchanges = [
      DONE,
      {
        ...DONE,
        id: "turn-2",
        origin: { ...DONE.origin, channelId: "chan-2" },
      },
      { ...DONE, id: "turn-3", origin: undefined },
      { ...DONE, id: "turn-4", origin: { ...DONE.origin, dismissed: true } },
    ];
    mount();
    expect(
      [...document.querySelectorAll("[data-ask-channel-turn]")].map((node) =>
        node.getAttribute("data-ask-channel-turn"),
      ),
    ).toEqual(["turn-1"]);
  });

  it("redraws only the turn's own row while its answer is written", () => {
    // Every piece of an answer is a new conversation. The channel reads
    // which turns it has and where, which a piece does not change. One
    // element for the channel, so only a context or store it reads can
    // draw it again.
    const channel = <Channel />;
    const bridge = () => (
      <AskInChannelBridge access="yes">{channel}</AskInChannelBridge>
    );
    const working = { ...DONE, phase: "working", answer: null };
    state.exchanges = [{ ...working, preview: "The budget" }];
    const view = render(bridge());
    expect(screen.getByRole("article")).toHaveTextContent("The budget");
    const before = drew.mock.calls.length;
    state.exchanges = [{ ...working, preview: "The budget vote is" }];
    view.rerender(bridge());
    expect(screen.getByRole("article")).toHaveTextContent("The budget vote is");
    // Nor does a turn asked through another door (the Ask card).
    state.exchanges = [
      { ...working, preview: "The budget vote is in" },
      { ...DONE, id: "card-turn", origin: undefined },
    ];
    view.rerender(bridge());
    expect(screen.getByRole("article")).toHaveTextContent(
      "The budget vote is in",
    );
    expect(drew).toHaveBeenCalledTimes(before);
    // The answer landing ends the question, which the composer reads.
    state.exchanges = [DONE];
    view.rerender(bridge());
    expect(screen.getByTestId("ask")).toHaveTextContent("ready");
    expect(drew.mock.calls.length).toBeGreaterThan(before);
  });

  it("draws a new turn, and takes a dismissed one away", () => {
    state.exchanges = [DONE];
    const view = mount();
    state.exchanges = [
      DONE,
      { ...DONE, id: "turn-5", question: "And the formal?" },
    ];
    view.rerender(tree("yes"));
    expect(document.querySelectorAll("[data-ask-channel-turn]")).toHaveLength(
      2,
    );
    state.exchanges = [
      { ...DONE, origin: { ...DONE.origin, dismissed: true } },
      { ...DONE, id: "turn-5", question: "And the formal?" },
    ];
    view.rerender(tree("yes"));
    expect(
      [...document.querySelectorAll("[data-ask-channel-turn]")].map((node) =>
        node.getAttribute("data-ask-channel-turn"),
      ),
    ).toEqual(["turn-5"]);
  });
});

describe("AskChannelTurn", () => {
  it("reads as Frapp speaking, marked private, with the member's question above the answer", () => {
    state.exchanges = [DONE];
    mount();
    const turn = screen.getByRole("article", {
      name: "Frapp. Only you can see this.",
    });
    expect(turn).toHaveTextContent("Frapp");
    expect(turn).toHaveTextContent("Only you can see this");
    expect(turn).toHaveTextContent("When is the budget vote?");
    expect(turn).toHaveTextContent("The budget vote is in the minutes.");
    // The question comes before the answer.
    expect(
      screen
        .getByText("When is the budget vote?")
        .compareDocumentPosition(
          screen.getByText("The budget vote is in the minutes."),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("takes itself out of the channel on Dismiss, and nothing else", async () => {
    state.exchanges = [DONE];
    mount();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Dismiss" }));
    expect(state.dismiss).toHaveBeenCalledWith("turn-1");
  });

  it("offers no Dismiss while the answer is still coming", () => {
    state.exchanges = [{ ...DONE, phase: "working", answer: null }];
    mount();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.getByRole("article")).toHaveTextContent(
      "When is the budget vote?",
    );
  });

  it("asks a failed turn again with the same asks, where it was first asked", async () => {
    state.exchanges = [
      {
        ...DONE,
        phase: "failed",
        answer: null,
        failure: { message: "Couldn't reach Frapp.", retryable: true },
      },
    ];
    mount();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(state.retry).toHaveBeenCalledWith("turn-1", {
      actions: false,
      gate: state.consent,
    });
  });

  it("draws nothing outside the bridge", () => {
    render(<AskChannelTurn id="turn-1" />);
    expect(document.querySelector("[data-ask-channel-turn]")).toBeNull();
  });
});

describe("posting an answer for everyone here (#4713)", () => {
  const SEALED = { ...DONE, answer: { ...DONE.answer, report_receipt: "r1" } };
  const post = () => screen.queryByRole("button", { name: /^Post/ });

  it("offers it under an answer the server sealed, beside Dismiss", async () => {
    state.exchanges = [SEALED];
    mount();
    const action = screen.getByRole("button", {
      name: "Post for everyone here",
    });
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
    // The hook is handed this channel and this answer, nothing typed.
    expect(state.posting.at(-1)).toMatchObject({
      channelId: "chan-1",
      answer: SEALED.answer,
    });
    await userEvent.setup().click(action);
    expect(state.post.start).toHaveBeenCalledTimes(1);
    expect(state.post.confirm).not.toHaveBeenCalled();
  });

  it.each([
    ["an answer with no receipt", DONE],
    [
      "a turn with nothing found",
      { ...SEALED, answer: { ...SEALED.answer, status: "not_found" } },
    ],
    // A request's card comes with no answer, so there is nothing sealed to
    // post: a card stays with the member who asked for it.
    ["a turn with no answer, as a card has", { ...SEALED, answer: null }],
    [
      "a failed turn",
      {
        ...SEALED,
        phase: "failed",
        answer: null,
        failure: { message: "Couldn't reach Frapp.", retryable: true },
      },
    ],
  ])("offers nothing to post for %s, only Dismiss", (_what, exchange) => {
    state.exchanges = [exchange];
    mount();
    expect(post()).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
    expect(state.posting).toEqual([]);
  });

  it("says it is checking, in the action's place", () => {
    state.exchanges = [SEALED];
    state.post.stage = "checking";
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking who can open the sources",
    );
    expect(post()).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
  });

  it("says what posting does before it does it, with Post and Cancel", async () => {
    state.exchanges = [SEALED];
    state.post.stage = "confirm";
    mount();
    const step = screen.getByRole("group", { name: "Post for everyone here" });
    expect(step).toHaveTextContent(
      "Everyone here will see your question and this answer.",
    );
    expect(step).not.toHaveTextContent("Not everyone here can open");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Post" }));
    expect(state.post.confirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.post.cancel).toHaveBeenCalledTimes(1);
    // Dismiss waits while the asker is deciding.
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("names what not everyone here can open, and the button says it is posted anyway", () => {
    state.exchanges = [SEALED];
    Object.assign(state.post, {
      stage: "confirm",
      restricted: [
        { key: "tool:my_tasks", kind: "tasks", title: "Your tasks" },
        { key: "meeting:m1", kind: "minutes", title: "Exec minutes" },
      ],
    });
    mount();
    expect(
      screen.getByRole("group", { name: "Post for everyone here" }),
    ).toHaveTextContent(
      "Not everyone here can open: Your tasks and Exec minutes.",
    );
    expect(screen.getByRole("button", { name: "Post anyway" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  });

  it("says so when the list changed under the asker", () => {
    state.exchanges = [SEALED];
    Object.assign(state.post, { stage: "confirm", changed: true });
    mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Who can open the sources changed. Check the list again.",
    );
  });

  it("holds both buttons while it posts", () => {
    state.exchanges = [SEALED];
    state.post.stage = "posting";
    mount();
    expect(screen.getByRole("button", { name: "Posting" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("says why it could not be posted, where the asker is looking", () => {
    state.exchanges = [SEALED];
    state.post.error = "That didn't post. Try again.";
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That didn't post. Try again.",
    );
    // The action is still there to try again.
    expect(post()).not.toBeNull();
  });

  it("offers no action for an answer that read chat, and says why in its place", () => {
    state.exchanges = [
      { ...SEALED, answer: { ...SEALED.answer, read_chat: true } },
    ];
    mount();
    expect(post()).toBeNull();
    expect(state.posting).toEqual([]);
    expect(
      screen.getByText("This answer read chat messages, so it stays with you."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("takes the asker's own copy out of the channel once it is posted", () => {
    state.exchanges = [SEALED];
    mount();
    state.posting.at(-1)!.onPosted();
    expect(state.dismiss).toHaveBeenCalledWith("turn-1");
  });
});
