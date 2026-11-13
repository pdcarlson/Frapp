/** @vitest-environment jsdom */
import React from "react";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import type { AskExchange } from "@repo/hooks";
import type { AskAnswer } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * `@Frapp` in a channel on the phone, answered to the asker alone (#4713):
 * what a channel asks with, which turns it draws, how one reads, and how the
 * list's rows learn where the turns sit.
 */

const hooks = vi.hoisted(() => ({
  exchanges: [] as unknown[],
  ask: vi.fn(),
  retry: vi.fn(),
  dismiss: vi.fn(),
  hasAsk: true,
  mayAct: false,
  post: {
    stage: "idle" as string,
    restricted: [] as { key: string; kind: string; title: string }[],
    changed: false,
    error: null as string | null,
    start: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
  },
  posting: [] as { channelId: string; onPosted: () => void }[],
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ ask: hooks.hasAsk }),
  useMayAct: () => hooks.mayAct,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAskPostFlow: (input: { channelId: string; onPosted: () => void }) => {
    hooks.posting.push(input);
    return hooks.post;
  },
  useAsk: () => ({
    exchanges: hooks.exchanges,
    working: (hooks.exchanges as { phase: string }[]).some(
      (exchange) => exchange.phase === "working",
    ),
    ask: hooks.ask,
    retry: hooks.retry,
    setProposal: vi.fn(),
    resolveProposal: vi.fn(),
    dismissFromChannel: hooks.dismiss,
    stop: vi.fn(),
    reset: vi.fn(),
  }),
  useDocumentDownloadUrl: () => ({ mutateAsync: vi.fn() }),
  useChannels: () => ({ data: [] }),
}));

const gate = vi.hoisted(() => ({ ensureConsent: vi.fn() }));
vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({
    ensureConsent: gate.ensureConsent,
    consentSheet: React.createElement("ConsentSheet"),
  }),
}));
vi.mock("@/components/ai/report-ai-sheet", () => ({
  useAiReport: () => ({
    offered: true,
    isReported: () => false,
    report: vi.fn(),
    reportSheet: React.createElement("ReportSheet"),
  }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#8B5CF6",
    accentPrimary: "#7C3AED",
    accentOnPrimary: "#FFFFFF",
  }),
}));

import { FrappCrest } from "@/components/frapp-crest";
import {
  AskTurnsUnder,
  useAskTurnsPlacement,
  useChannelAsk,
  type ChannelAsk,
} from "./ask-in-channel";

const MINUTES = {
  id: "s1",
  kind: "meeting",
  title: "Chapter meeting",
  detail: null,
  date: "2026-11-09T12:00:00Z",
  target: { type: "meeting", meeting_id: "m1" },
};

function answered(over: Partial<AskExchange> = {}): AskExchange {
  const answer: AskAnswer = {
    status: "answered",
    reason: null,
    text: "Quorum is half.",
    citations: [{ source: 0, at: 15, quote: "half" }],
    sources: [MINUTES],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  } as AskAnswer;
  return {
    id: "turn-1",
    question: "What is quorum?",
    phase: "done",
    step: null,
    preview: "",
    answer,
    proposal: null,
    resolution: null,
    failure: null,
    origin: {
      channelId: "chan-1",
      at: "2026-11-13T16:00:00.000Z",
      after: "c9",
    },
    ...over,
  };
}

/** What the screen reads, and the two rows of a list that could hold a turn. */
const seen: { ask: ChannelAsk | null } = { ask: null };
function Channel() {
  const ask = useChannelAsk("chan-1");
  useEffect(() => {
    seen.ask = ask;
  });
  const byRow = new Map(ask && ask.turns.length > 0 ? [["c9", ask.turns]] : []);
  const placement = useAskTurnsPlacement(byRow, ask?.renderTurn);
  return (
    <>
      <AskTurnsUnder placement={placement} rowKey="c9" />
      <AskTurnsUnder placement={placement} rowKey="c8" />
      {ask?.sheets}
    </>
  );
}

const tree = () => (
  <FrappThemeProvider>
    <Channel />
  </FrappThemeProvider>
);
function render(): ReactTestRenderer {
  let rendered!: ReactTestRenderer;
  act(() => {
    rendered = create(tree());
  });
  return rendered;
}

const turns = (rendered: ReactTestRenderer) =>
  rendered.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      String(node.props.testID).startsWith("ask-channel-turn-"),
  );
const byLabel = (rendered: ReactTestRenderer, label: string) =>
  rendered.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  );

beforeEach(() => {
  vi.clearAllMocks();
  hooks.exchanges = [];
  hooks.hasAsk = true;
  hooks.mayAct = false;
  Object.assign(hooks.post, {
    stage: "idle",
    restricted: [],
    changed: false,
    error: null,
  });
  hooks.posting.length = 0;
  hooks.ask.mockResolvedValue(undefined);
  hooks.retry.mockResolvedValue(undefined);
  gate.ensureConsent.mockResolvedValue(true);
});

describe("asking from a channel", () => {
  it("gives a member without Ask nothing: no way to ask, no turns, no sheets", () => {
    hooks.hasAsk = false;
    hooks.exchanges = [answered()];
    const rendered = render();
    expect(seen.ask).toBeNull();
    expect(turns(rendered)).toHaveLength(0);
    expect(rendered.root.findAllByType("ConsentSheet" as never)).toHaveLength(
      0,
    );
    expect(rendered.root.findAllByType("ReportSheet" as never)).toHaveLength(0);
  });

  it("asks with the channel and the message it was asked under, behind the consent gate", () => {
    const rendered = render();
    expect(rendered.root.findAllByType("ConsentSheet" as never)).toHaveLength(
      1,
    );
    act(() => seen.ask!.send("when is formal?", "c9"));
    expect(hooks.ask).toHaveBeenCalledWith("when is formal?", {
      actions: false,
      gate: gate.ensureConsent,
      channelId: "chan-1",
      afterMessage: "c9",
    });
  });

  it("never says the saved notice was shown, so nothing from a channel is kept (#4315)", () => {
    render();
    act(() => seen.ask!.send("when is formal?", null));
    expect(hooks.ask.mock.calls[0]![1]).not.toHaveProperty("savedNoticeShown");
  });

  it("lets Frapp propose only for a member who may have it act", () => {
    hooks.mayAct = true;
    render();
    act(() => seen.ask!.send("give Ana 5 points", null));
    expect(hooks.ask.mock.calls[0]![1]).toMatchObject({ actions: true });
  });

  it("draws the turns asked in this channel, not another's, the sheet's own or a dismissed one", () => {
    hooks.exchanges = [
      answered(),
      answered({
        id: "turn-2",
        origin: { channelId: "chan-2", at: "2026-11-13T16:00:00.000Z" },
      }),
      answered({ id: "turn-3", origin: undefined }),
      answered({
        id: "turn-4",
        origin: {
          channelId: "chan-1",
          at: "2026-11-13T16:00:00.000Z",
          dismissed: true,
        },
      }),
    ];
    const rendered = render();
    expect(seen.ask!.turns.map((turn) => turn.id)).toEqual(["turn-1"]);
    expect(turns(rendered).map((node) => node.props.testID)).toEqual([
      "ask-channel-turn-turn-1",
    ]);
  });
});

describe("a turn in the channel", () => {
  it("reads as Frapp speaking, marked private, with the member's question above the answer", () => {
    hooks.exchanges = [answered()];
    const rendered = render();
    expect(byLabel(rendered, "Frapp. Only you can see this.")).toHaveLength(1);
    const text = screenText(rendered);
    expect(text).toContain("Only you can see this");
    expect(text.indexOf("What is quorum?")).toBeGreaterThan(-1);
    expect(text.indexOf("Quorum is half.")).toBeGreaterThan(
      text.indexOf("What is quorum?"),
    );
    // The crest in the chapter's colour, as the Ask Frapp bar draws it.
    expect(rendered.root.findByType(FrappCrest).props.color).toBe("#8B5CF6");
  });

  it("takes itself out of the channel on Dismiss", () => {
    hooks.exchanges = [answered()];
    const rendered = render();
    act(() => byLabel(rendered, "Dismiss")[0]!.props.onPress());
    expect(hooks.dismiss).toHaveBeenCalledWith("turn-1");
  });

  it("offers no Dismiss while the answer is still coming", () => {
    hooks.exchanges = [answered({ phase: "working", answer: null })];
    const rendered = render();
    expect(byLabel(rendered, "Dismiss")).toHaveLength(0);
    expect(screenText(rendered)).toContain("What is quorum?");
  });

  it("opens a source's screen over the channel", async () => {
    hooks.exchanges = [answered()];
    const rendered = render();
    const source = rendered.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Source 1:"),
    )[0]!;
    await act(async () => source.props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/minutes-details?id=m1",
    );
  });

  it("asks a failed turn again with the same asks", () => {
    hooks.exchanges = [
      answered({
        phase: "failed",
        answer: null,
        failure: { message: "Couldn't reach Frapp.", retryable: true },
      }),
    ];
    const rendered = render();
    act(() => byLabel(rendered, "Try again")[0]!.props.onPress());
    expect(hooks.retry).toHaveBeenCalledWith("turn-1", {
      actions: false,
      gate: gate.ensureConsent,
    });
  });
});

describe("where the rows learn of a turn", () => {
  it("draws a turn asked after the list was on screen, under its row only", () => {
    const rendered = render();
    expect(turns(rendered)).toHaveLength(0);
    hooks.exchanges = [answered()];
    act(() => rendered.update(tree()));
    expect(turns(rendered)).toHaveLength(1);
    // And takes it away again when it is dismissed.
    hooks.exchanges = [];
    act(() => rendered.update(tree()));
    expect(turns(rendered)).toHaveLength(0);
  });
});

describe("posting an answer for everyone here (#4713)", () => {
  const sealed = () =>
    answered({
      answer: { ...answered().answer!, report_receipt: "sealed" } as AskAnswer,
    });
  it("offers it under an answer the server sealed, beside Dismiss", () => {
    hooks.exchanges = [sealed()];
    const rendered = render();
    expect(byLabel(rendered, "Dismiss")).not.toHaveLength(0);
    // Pressing it only starts the check: nothing is posted by this press.
    act(() => byLabel(rendered, "Post for everyone here")[0]!.props.onPress());
    expect(hooks.post.start).toHaveBeenCalledTimes(1);
    expect(hooks.post.confirm).not.toHaveBeenCalled();
    expect(hooks.posting.at(-1)).toMatchObject({ channelId: "chan-1" });
  });

  it("offers nothing to post for an answer with no receipt, a turn with no answer or nothing found", () => {
    hooks.exchanges = [
      answered(),
      // As a card has: no answer to post.
      answered({ id: "turn-2", answer: null }),
      answered({
        id: "turn-3",
        answer: {
          ...answered().answer!,
          status: "not_found",
          report_receipt: "sealed",
        } as AskAnswer,
      }),
    ];
    const rendered = render();
    expect(byLabel(rendered, "Post for everyone here")).toHaveLength(0);
    expect(hooks.posting).toEqual([]);
    expect(byLabel(rendered, "Dismiss")).not.toHaveLength(0);
  });

  it("says it is checking, in the action's place", () => {
    hooks.exchanges = [sealed()];
    hooks.post.stage = "checking";
    const rendered = render();
    expect(byLabel(rendered, "Post for everyone here")).toHaveLength(0);
    expect(screenText(rendered)).toContain("Checking who can open the sources");
    expect(byLabel(rendered, "Dismiss")).not.toHaveLength(0);
  });

  it("says what posting does before it does it, with Post and Cancel", () => {
    hooks.exchanges = [sealed()];
    hooks.post.stage = "confirm";
    const rendered = render();
    const text = screenText(rendered);
    expect(text).toContain(
      "Everyone here will see your question and this answer.",
    );
    expect(text).not.toContain("Not everyone here can open");
    expect(byLabel(rendered, "Post")).not.toHaveLength(0);
    expect(byLabel(rendered, "Cancel")).not.toHaveLength(0);
    // Dismiss waits behind the choice.
    expect(byLabel(rendered, "Dismiss")).toHaveLength(0);
  });

  it("names what not everyone here can open, and the button says it is posted anyway", () => {
    hooks.exchanges = [sealed()];
    Object.assign(hooks.post, {
      stage: "confirm",
      restricted: [
        { key: "tool:my_tasks", kind: "tasks", title: "Your tasks" },
        { key: "meeting:m1", kind: "meeting", title: "Exec minutes" },
      ],
    });
    const rendered = render();
    const text = screenText(rendered);
    expect(text).toContain("Not everyone here can open");
    expect(text).toContain("Your tasks and Exec minutes");
    expect(byLabel(rendered, "Post anyway")).not.toHaveLength(0);
    expect(byLabel(rendered, "Post")).toHaveLength(0);
  });

  it("says so when the list changed, and why it could not be posted", () => {
    hooks.exchanges = [sealed()];
    Object.assign(hooks.post, {
      stage: "confirm",
      changed: true,
      error: "That didn't post. Try again.",
    });
    const text = screenText(render());
    expect(text).toContain(
      "Who can open the sources changed. Check the list again.",
    );
    expect(text).toContain("That didn't post. Try again.");
  });

  it("holds both buttons while it posts", () => {
    hooks.exchanges = [sealed()];
    hooks.post.stage = "posting";
    const rendered = render();
    for (const label of ["Posting", "Cancel"]) {
      const disabled = byLabel(rendered, label).some(
        (node) => node.props.accessibilityState?.disabled === true,
      );
      expect(disabled, label).toBe(true);
    }
  });

  it("offers no action for an answer that read chat, and says why in its place", () => {
    hooks.exchanges = [
      answered({
        answer: {
          ...answered().answer!,
          report_receipt: "sealed",
          read_chat: true,
        } as AskAnswer,
      }),
    ];
    const rendered = render();
    expect(byLabel(rendered, "Post for everyone here")).toHaveLength(0);
    expect(hooks.posting).toEqual([]);
    expect(screenText(rendered)).toContain(
      "This answer read chat messages, so it stays with you.",
    );
    expect(byLabel(rendered, "Dismiss")).not.toHaveLength(0);
  });

  it("offers no action for a follow-up, whose answer leaned on earlier turns", () => {
    hooks.exchanges = [{ ...sealed(), followedUp: true }];
    const rendered = render();
    expect(byLabel(rendered, "Post for everyone here")).toHaveLength(0);
    expect(screenText(rendered)).toContain(
      "This answer followed earlier questions, so it stays with you.",
    );
    expect(byLabel(rendered, "Dismiss")).not.toHaveLength(0);
  });

  it("takes the asker's own copy out of the channel once it is posted", () => {
    hooks.exchanges = [sealed()];
    render();
    hooks.posting.at(-1)!.onPosted();
    expect(hooks.dismiss).toHaveBeenCalledWith("turn-1");
  });
});
