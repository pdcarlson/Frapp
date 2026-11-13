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
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ ask: hooks.hasAsk }),
  useMayAct: () => hooks.mayAct,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
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
}));

const gate = vi.hoisted(() => ({ ensureConsent: vi.fn() }));
vi.mock("@/components/ai/ai-consent-sheet", () => ({
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
