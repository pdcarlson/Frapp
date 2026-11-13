/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { AskExchange } from "@repo/hooks";
import {
  ACT_COPY,
  AI_REPORT_COPY,
  ASK_COPY,
  askSavedLine,
  askUnavailableLine,
  type AskAnswer,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Ask Frapp's sheet on the phone (#450, #451, #718): one conversation in one
 * field, what a member sees for each way a turn can end, and what is sent
 * with a question. A turn's own states are in `ask-turn.spec.tsx`, a card's
 * in `ask-proposal.spec.tsx`.
 */

const hooks = vi.hoisted(() => ({
  exchanges: [] as unknown[],
  ask: vi.fn(),
  retry: vi.fn(),
  setProposal: vi.fn(),
  resolveProposal: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  statusEnabled: [] as boolean[],
  savedUntil: null as string | null,
  download: vi.fn(),
  actions: [] as string[],
  actEnabled: [] as boolean[],
  mayAct: false,
  suggestions: [] as Array<{ kind: string; text: string; request: boolean }>,
  suggestionsEnabled: [] as boolean[],
}));
vi.mock("@/lib/ai/availability", () => ({
  useMayAct: () => hooks.mayAct,
  useActActions: (options: { enabled: boolean }) => {
    hooks.actEnabled.push(options.enabled);
    return hooks.actions;
  },
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
    setProposal: hooks.setProposal,
    resolveProposal: hooks.resolveProposal,
    stop: hooks.stop,
    reset: hooks.reset,
  }),
  useAskStatus: (options: { enabled: boolean }) => {
    hooks.statusEnabled.push(options.enabled);
    return {
      data: options.enabled ? { saved_until: hooks.savedUntil } : undefined,
    };
  },
  useDocumentDownloadUrl: () => ({ mutateAsync: hooks.download }),
  useAskSuggestions: (options: { enabled: boolean }) => {
    hooks.suggestionsEnabled.push(options.enabled);
    return { suggestions: options.enabled ? hooks.suggestions : [] };
  },
  useActEventAudience: () => ({ mutateAsync: vi.fn() }),
  useAcceptAiSuggestion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDismissAiSuggestion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChapterRoster: () => ({
    data: [{ user_id: "u1", display_name: "Ana Ruiz" }],
    isSuccess: true,
    isPending: false,
  }),
  useCurrentUser: () => ({ data: { id: "me" } }),
}));

const gate = vi.hoisted(() => ({ ensureConsent: vi.fn() }));
vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({
    ensureConsent: gate.ensureConsent,
    consentSheet: null,
  }),
}));

const reporting = vi.hoisted(() => ({
  offered: true,
  reported: false,
  report: vi.fn(),
}));
vi.mock("@/components/ai/report-ai-sheet", () => ({
  useAiReport: () => ({
    offered: reporting.offered,
    isReported: () => reporting.reported,
    report: reporting.report,
    reportSheet: null,
  }),
}));

// A purple chapter. The header's crest, the member's bubble and the send
// button take it (#4702); Frapp's source markers keep Ask's fixed gold.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#8B5CF6",
    accentPrimary: "#7C3AED",
    accentOnPrimary: "#FFFFFF",
  }),
}));

import { FrappCrest } from "@/components/frapp-crest";
import { AskSheet } from "./ask-sheet";

const modal = { present: vi.fn(), dismiss: vi.fn() };

function render(onClosed?: () => void): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AskSheet ref={React.createRef<never>()} onClosed={onClosed} />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal" ? modal : null,
      },
    );
  });
  return tree;
}

const sheet = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "BottomSheetModal")[0];
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  );
const open = (tree: ReactTestRenderer) =>
  act(() => sheet(tree).props.onAnimate(-1, 0));
/** What the server built from this member's account (#4700). */
const EVENT = {
  kind: "event",
  text: "When and where is Formal on Friday?",
  request: false,
};
const REQUEST = {
  kind: "request",
  text: "Make a task for me to get ready for Sunday's event, due Saturday",
  request: true,
};
async function askSuggested(tree: ReactTestRenderer, suggestion = EVENT) {
  await act(async () => byLabel(tree, suggestion.text)[0].props.onPress());
}

const DOCUMENT = {
  id: "s1",
  kind: "document",
  title: "Bylaws",
  detail: null,
  date: null,
  target: { type: "document", document_id: "d1", page: null },
};
const MINUTES = {
  id: "s2",
  kind: "meeting",
  title: "Chapter meeting",
  detail: null,
  date: "2026-11-09T12:00:00Z",
  target: { type: "meeting", meeting_id: "m1" },
};
function answered(): AskExchange {
  const answer: AskAnswer = {
    status: "answered",
    reason: null,
    text: "Quorum is half. It was voted.",
    citations: [
      { source: 0, at: 15, quote: "half" },
      { source: 1, at: 29, quote: "voted" },
    ],
    sources: [DOCUMENT, MINUTES],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  };
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
  };
}
const working = (): AskExchange => ({
  ...answered(),
  id: "turn-2",
  question: "And for elections?",
  phase: "working",
  answer: null,
});
const POINTS_CARD = {
  status: "proposed",
  action: "give_points",
  suggestion: {
    id: "sg-1",
    kind: "points",
    points: {
      amount: 5,
      reason: "Came to chapter",
      target_user_ids: ["u1"],
      event_name: null,
      event_start_time: null,
    },
    task: null,
    new_event: null,
  },
  notes: [],
  event_choice: null,
  missing: null,
  reason: null,
  available_actions: [],
};
const proposed = (): AskExchange => ({
  ...answered(),
  id: "turn-3",
  question: "Give Ana 5 points",
  answer: null,
  proposal: POINTS_CARD as never,
});
const field = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) => (node.type as unknown) === "BottomSheetTextInput",
  )[0]!;
/** What a question is sent with, for a member who can only ask. */
const ASKING = {
  savedNoticeShown: false,
  actions: false,
  gate: expect.any(Function),
};
const sourceRow = (tree: ReactTestRenderer, number: number) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      String(node.props.accessibilityLabel).startsWith(`Source ${number}:`),
  )[0];

beforeEach(() => {
  vi.clearAllMocks();
  hooks.exchanges = [];
  hooks.statusEnabled = [];
  hooks.savedUntil = null;
  hooks.actions = [];
  hooks.actEnabled = [];
  hooks.mayAct = false;
  hooks.suggestions = [EVENT];
  hooks.suggestionsEnabled = [];
  reporting.offered = true;
  reporting.reported = false;
  gate.ensureConsent.mockResolvedValue(true);
  vi.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({
    type: "dismiss",
  } as never);
});

describe("AskSheet", () => {
  it("opens on what Frapp answers from and what this member could ask about their own account, with no word about one question at a time", () => {
    const tree = render();
    open(tree);
    const text = screenText(tree);
    expect(text).toContain(ASK_COPY.name);
    expect(text).toContain(ASK_COPY.empty_title);
    expect(text).toContain(ASK_COPY.empty_body);
    expect(text).toContain(EVENT.text);
    expect(text).not.toContain("answered on its own");
    // They fade in where nothing sits below them.
    const list = tree.root.findAll(
      (node) => (node.type as unknown) === "Animated.View",
    );
    expect(list).toHaveLength(1);
    expect(list[0].props.entering).toMatchObject({ animation: "FadeIn" });
    expect(field(tree).props.placeholder).toBe(ASK_COPY.placeholder);
    // Nothing to clear yet.
    expect(byLabel(tree, ASK_COPY.new_conversation)).toHaveLength(0);
  });

  it("opens plain for a member with nothing to ask about: no preset stands in", () => {
    hooks.suggestions = [];
    const tree = render();
    open(tree);
    expect(screenText(tree)).toContain(ASK_COPY.empty_title);
    expect(
      tree.root.findAll((node) => node.props.accessibilityHint === "Sends this."),
    ).toHaveLength(0);
  });

  it("sends a tapped question as a suggestion, and the one request like typed words", async () => {
    hooks.mayAct = true;
    hooks.suggestions = [EVENT, REQUEST];
    const tree = render();
    open(tree);
    await askSuggested(tree);
    expect(hooks.ask).toHaveBeenLastCalledWith(EVENT.text, {
      ...ASKING,
      actions: true,
      suggested: true,
    });
    await askSuggested(tree, REQUEST);
    expect(hooks.ask).toHaveBeenLastCalledWith(REQUEST.text, {
      ...ASKING,
      actions: true,
      suggested: false,
    });
  });

  it("asks nothing of the server until the sheet is actually open", () => {
    const tree = render();
    expect(hooks.statusEnabled.every((enabled) => !enabled)).toBe(true);
    expect(hooks.actEnabled.every((enabled) => !enabled)).toBe(true);
    expect(hooks.suggestionsEnabled.every((enabled) => !enabled)).toBe(true);
    open(tree);
    expect(hooks.suggestionsEnabled.at(-1)).toBe(true);
    expect(hooks.statusEnabled.at(-1)).toBe(true);
    expect(hooks.actEnabled.at(-1)).toBe(true);
  });

  it("sends what was typed with the consent gate, and clears the field", () => {
    const tree = render();
    act(() => field(tree).props.onChangeText("What is quorum?"));
    act(() => byLabel(tree, ASK_COPY.send)[0].props.onPress());
    expect(hooks.ask).toHaveBeenCalledWith("What is quorum?", ASKING);
    // The gate is the AI sheet's: the hook runs it once the turn is on screen.
    expect(hooks.ask.mock.calls[0]![1].gate).toBe(gate.ensureConsent);
    expect(field(tree).props.value).toBe("");
  });

  it("says questions are saved, and only then tells the server it said so", async () => {
    hooks.savedUntil = "2026-11-26T12:00:00Z";
    const tree = render();
    expect(screenText(tree)).not.toContain(askSavedLine("November 26, 2026"));
    open(tree);
    expect(screenText(tree)).toContain(askSavedLine("November 26, 2026"));
    await askSuggested(tree);
    expect(hooks.ask).toHaveBeenCalledWith(EVENT.text, {
      ...ASKING,
      savedNoticeShown: true,
      suggested: true,
    });
  });

  it("keeps every turn of the conversation on screen, oldest first", () => {
    hooks.exchanges = [answered(), working()];
    const text = screenText(render());
    expect(text).toContain("What is quorum?");
    expect(text).toContain("Quorum is half.");
    expect(text).toContain("And for elections?");
    expect(text.indexOf("What is quorum?")).toBeLessThan(
      text.indexOf("And for elections?"),
    );
    expect(text).not.toContain(ASK_COPY.empty_body);
  });

  it("starts a new conversation from the header", () => {
    hooks.exchanges = [answered()];
    const tree = render();
    act(() => byLabel(tree, ASK_COPY.new_conversation)[0].props.onPress());
    expect(hooks.reset).toHaveBeenCalledTimes(1);
  });

  it("asks a refused or failed turn again in its place", () => {
    hooks.exchanges = [
      {
        ...answered(),
        answer: {
          ...answered().answer!,
          status: "unavailable",
          reason: "consent_required",
        },
      },
      {
        ...working(),
        phase: "failed",
        failure: { message: "Couldn't reach Frapp.", retryable: true },
      },
    ];
    const tree = render();
    expect(screenText(tree)).toContain(askUnavailableLine("consent_required"));
    act(() => byLabel(tree, ASK_COPY.consent_action)[0].props.onPress());
    expect(hooks.retry).toHaveBeenLastCalledWith("turn-1", ASKING);
    act(() => byLabel(tree, ASK_COPY.try_again)[0].props.onPress());
    expect(hooks.retry).toHaveBeenLastCalledWith("turn-2", ASKING);
  });

  it("opens a document over the sheet, so the thread is still there", async () => {
    hooks.exchanges = [answered()];
    hooks.download.mockResolvedValue({
      downloadUrl: "https://files.example/d1",
    });
    const tree = render();
    await act(async () => sourceRow(tree, 1).props.onPress());
    expect(hooks.download).toHaveBeenCalledWith("d1");
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://files.example/d1",
    );
    expect(modal.dismiss).not.toHaveBeenCalled();
  });

  it("says a document didn't open rather than doing nothing", async () => {
    hooks.exchanges = [answered()];
    hooks.download.mockRejectedValue(new Error("gone"));
    const tree = render();
    await act(async () => sourceRow(tree, 1).props.onPress());
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("That source didn't open. Try again.");
  });

  it("closes and opens the minutes screen for a minutes source", async () => {
    hooks.exchanges = [answered()];
    const tree = render();
    await act(async () => sourceRow(tree, 2).props.onPress());
    expect(modal.dismiss).toHaveBeenCalled();
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/minutes-details?id=m1",
    );
  });

  it("tells its host when it closed for a source, and only that once", async () => {
    const onClosed = vi.fn();
    hooks.exchanges = [answered()];
    const tree = render(onClosed);
    await act(async () => sourceRow(tree, 2).props.onPress());
    act(() => sheet(tree).props.onDismiss());
    expect(onClosed).toHaveBeenLastCalledWith(true);
    act(() => sheet(tree).props.onDismiss());
    expect(onClosed).toHaveBeenLastCalledWith(false);
  });

  it("drops a question still being answered when the sheet closes, and keeps the thread", () => {
    const onClosed = vi.fn();
    hooks.exchanges = [answered(), working()];
    const busy = render(onClosed);
    act(() => sheet(busy).props.onDismiss());
    expect(hooks.stop).toHaveBeenCalledTimes(1);
    expect(hooks.reset).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledWith(false);

    hooks.stop.mockClear();
    hooks.exchanges = [answered()];
    const done = render();
    act(() => sheet(done).props.onDismiss());
    expect(hooks.stop).not.toHaveBeenCalled();
  });

  it("reports an answer by the ask's id, with the receipt exactly as it came", () => {
    hooks.exchanges = [
      {
        ...answered(),
        askId: "ask-1",
        answer: { ...answered().answer!, report_receipt: "sealed" },
      },
    ];
    const tree = render();
    act(() => byLabel(tree, AI_REPORT_COPY.titles.ask_answer)[0]!.props.onPress());
    expect(reporting.report).toHaveBeenCalledWith({
      subject: "ask_answer",
      subjectId: "ask-1",
      receipt: "sealed",
    });
  });

  it("offers no report to a member who can't send one, or before the ask has an id", () => {
    hooks.exchanges = [answered()];
    expect(byLabel(render(), AI_REPORT_COPY.titles.ask_answer)).toHaveLength(0);
    hooks.exchanges = [{ ...answered(), askId: "ask-1" }];
    reporting.offered = false;
    expect(byLabel(render(), AI_REPORT_COPY.titles.ask_answer)).toHaveLength(0);
  });

  it("can't send an empty question or a second one while the first is answered", () => {
    const empty = render();
    expect(byLabel(empty, ASK_COPY.send)[0].props.disabled).toBe(true);

    hooks.exchanges = [working()];
    const busy = render();
    act(() => field(busy).props.onChangeText("Another?"));
    expect(byLabel(busy, ASK_COPY.send)[0].props.disabled).toBe(true);
    act(() => field(busy).props.onSubmitEditing());
    expect(hooks.ask).not.toHaveBeenCalled();
  });

  describe("asking for something to be done (#718)", () => {
    it("is one field for everyone: no switch, and no word about acting for a member who can't", () => {
      const tree = render();
      const text = screenText(tree);
      expect(text).not.toContain(ASK_COPY.empty_body_act);
      expect(
        tree.root.findAll((node) => node.props.accessibilityRole === "radio"),
      ).toHaveLength(0);
    });

    it("asks for a card on the permission alone: a request typed before the list of actions has loaded is still read as one", () => {
      hooks.mayAct = true;
      const tree = render();
      // The list only words the opening.
      expect(screenText(tree)).not.toContain(ASK_COPY.empty_body_act);
      act(() => field(tree).props.onChangeText("Give Ana 5 points"));
      act(() => field(tree).props.onSubmitEditing());
      expect(hooks.ask).toHaveBeenCalledWith("Give Ana 5 points", {
        ...ASKING,
        actions: true,
      });
    });

    it("holds Try again on an earlier turn while another is being answered: asking again would drop it", () => {
      hooks.exchanges = [
        {
          ...working(),
          id: "turn-1",
          phase: "failed",
          failure: { message: "Couldn't reach Frapp.", retryable: true },
        },
        working(),
      ];
      const tree = render();
      expect(byLabel(tree, ASK_COPY.try_again)[0].props.disabled).toBe(true);
    });

    it("tells a member Frapp can act for, and says so with what they type", () => {
      hooks.mayAct = true;
      hooks.actions = ["give_points", "create_task"];
      const tree = render();
      expect(screenText(tree)).toContain(ASK_COPY.empty_body_act);
      expect(
        tree.root.findAll((node) => node.props.accessibilityRole === "radio"),
      ).toHaveLength(0);
      act(() => field(tree).props.onChangeText("Give Ana 5 points"));
      act(() => field(tree).props.onSubmitEditing());
      expect(hooks.ask).toHaveBeenCalledWith("Give Ana 5 points", {
        ...ASKING,
        actions: true,
      });
    });

    it("shows a proposal as a card in the thread, and records how it ended on its turn", async () => {
      hooks.mayAct = true;
      hooks.actions = ["give_points"];
      hooks.exchanges = [answered(), proposed()];
      const tree = render();
      const text = screenText(tree);
      expect(text).toContain("Quorum is half.");
      expect(text).toContain("Give Ana 5 points");
      expect(text).toContain("Came to chapter");
      expect(text).toContain("Ana Ruiz");
      await act(async () => byLabel(tree, ACT_COPY.cancel)[0].props.onPress());
      expect(hooks.resolveProposal).toHaveBeenCalledWith("turn-3", {
        kind: "cancelled",
      });
    });

    it("leaves for the screen a confirmed change shows on", () => {
      hooks.exchanges = [
        {
          ...proposed(),
          resolution: { kind: "done", line: ACT_COPY.done_task, page: "tasks" },
        },
      ];
      const onClosed = vi.fn();
      const tree = render(onClosed);
      expect(screenText(tree)).toContain(ACT_COPY.done_task);
      act(() => byLabel(tree, ACT_COPY.open_tasks)[0].props.onPress());
      expect(modal.dismiss).toHaveBeenCalled();
      expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/tasks");
      act(() => sheet(tree).props.onDismiss());
      expect(onClosed).toHaveBeenLastCalledWith(true);
    });
  });
});

/**
 * The conversation is the app's tall sheet since #4702 (it was 78%): the bar
 * a member taps is drawn as this sheet's own field, so the tap lands in a
 * conversation, not a drawer over the tab.
 */
describe("the sheet itself (#4702)", () => {
  const flat = (style: unknown): Record<string, unknown> =>
    Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

  it("opens at full height, with dynamic sizing off so a short thread does not open it short", () => {
    const props = sheet(render()).props;
    expect(props.snapPoints).toEqual(["100%"]);
    expect(props.enableDynamicSizing).toBe(false);
    // Stops under the status bar, so the screen behind still shows.
    expect(props.topInset).toBeGreaterThan(0);
  });

  it("carries a close in its header, because at full height no scrim is left to tap", () => {
    modal.dismiss.mockClear();
    const tree = render();
    const close = byLabel(tree, ASK_COPY.close);
    expect(close).toHaveLength(1);
    act(() => close[0].props.onPress());
    expect(modal.dismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the close beside New conversation once there is a thread", () => {
    hooks.exchanges = [
      { id: "e1", question: "Who is treasurer?", phase: "done", answer: null },
    ];
    const tree = render();
    expect(byLabel(tree, ASK_COPY.new_conversation)).toHaveLength(1);
    expect(byLabel(tree, ASK_COPY.close)).toHaveLength(1);
    hooks.exchanges = [];
  });

  it("draws the crest and the send button in the chapter's colour", () => {
    const tree = render();
    expect(tree.root.findByType(FrappCrest).props.color).toBe("#8B5CF6");
    const send = byLabel(tree, ASK_COPY.send)[0];
    const style = flat(
      typeof send.props.style === "function"
        ? send.props.style({ pressed: false })
        : send.props.style,
    );
    // The solid accent pair, as web's send button always was.
    expect(style.backgroundColor).toBe("#7C3AED");
  });

  it("is drawn on the page's background, not the sheet grey", () => {
    const tree = render();
    const background = flat(
      sheet(tree)!.props.backgroundStyle,
    );
    // `surface.background`; a sheet's own fill is `surface.popover`.
    expect(String(background.backgroundColor)).toBe("#050505");
    // Still a sheet's shape.
    expect(background.borderTopLeftRadius).toBeGreaterThan(0);
  });
});
