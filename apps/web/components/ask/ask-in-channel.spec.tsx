import { render, screen } from "@testing-library/react";
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
  exchanges: [] as unknown[],
  permissions: ["ai:use"] as string[],
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
    setProposal: vi.fn(),
    resolveProposal: vi.fn(),
    dismissFromChannel: state.dismiss,
    stop: vi.fn(),
    reset: vi.fn(),
  }),
  useMyPermissions: () => ({ data: { permissions: state.permissions } }),
}));

vi.mock("@/components/ai/ai-consent-sheet", () => ({
  useAiConsentGate: () => ({
    ensureConsent: state.consent,
    consentDialog: <div data-testid="consent-dialog" />,
  }),
}));

const {
  AskChannelTurn,
  AskInChannelBridge,
  useChannelAsk,
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

/** What a channel's composer and timeline read, drawn so a test can too. */
function Channel({ channelId = "chan-1" }: { channelId?: string }) {
  const ask = useChannelAsk();
  const turns = useChannelAskTurns(channelId);
  const edits = useSharedAskCardEdits();
  return (
    <div>
      <p data-testid="ask">{ask ? (ask.busy ? "busy" : "ready") : "none"}</p>
      <p data-testid="edits">{edits ? "shared" : "none"}</p>
      <button
        type="button"
        onClick={() => ask?.send(channelId, "when is formal?", "c9")}
      >
        send
      </button>
      {turns.map((turn) => (
        <AskChannelTurn key={turn.id} exchange={turn} />
      ))}
    </div>
  );
}

const mount = (enabled = true, channelId?: string) =>
  render(
    <AskInChannelBridge enabled={enabled}>
      <Channel channelId={channelId} />
    </AskInChannelBridge>,
  );

beforeEach(() => {
  state.ask.mockReset().mockResolvedValue(undefined);
  state.retry.mockReset().mockResolvedValue(undefined);
  state.dismiss.mockReset();
  state.consent.mockReset().mockResolvedValue(true);
  state.exchanges = [];
  state.permissions = ["ai:use"];
});

describe("asking from a channel", () => {
  it("gives a member without Ask nothing: no way to ask, no turns, no consent sheet", async () => {
    state.exchanges = [DONE];
    mount(false);
    expect(screen.getByTestId("ask")).toHaveTextContent("none");
    expect(screen.getByTestId("edits")).toHaveTextContent("none");
    expect(document.querySelector("[data-ask-channel-turn]")).toBeNull();
    expect(screen.queryByTestId("consent-dialog")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "send" }));
    expect(state.ask).not.toHaveBeenCalled();
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
    render(<AskChannelTurn exchange={DONE as never} />);
    expect(document.querySelector("[data-ask-channel-turn]")).toBeNull();
  });
});
