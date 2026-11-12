/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { AskExchange } from "@repo/hooks";
import {
  ASK_COPY,
  askSavedLine,
  askUnavailableLine,
  type AskAnswer,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Ask Frapp's sheet on the phone (#450, #451): what a member sees for each
 * way a question can end, and that nothing is sent before they have said yes.
 * The card's own states are in `answer-card.spec.tsx`.
 */

const hooks = vi.hoisted(() => ({
  exchange: null as unknown,
  ask: vi.fn(),
  reset: vi.fn(),
  statusEnabled: [] as boolean[],
  savedUntil: null as string | null,
  download: vi.fn(),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAsk: () => ({
    exchange: hooks.exchange,
    ask: hooks.ask,
    reset: hooks.reset,
  }),
  useAskStatus: (options: { enabled: boolean }) => {
    hooks.statusEnabled.push(options.enabled);
    return {
      data: options.enabled ? { saved_until: hooks.savedUntil } : undefined,
    };
  },
  useDocumentDownloadUrl: () => ({ mutateAsync: hooks.download }),
}));

const gate = vi.hoisted(() => ({ ensureConsent: vi.fn() }));
vi.mock("@/components/ai/ai-consent-sheet", () => ({
  useAiConsentGate: () => ({
    ensureConsent: gate.ensureConsent,
    consentSheet: null,
  }),
}));

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
async function askExample(tree: ReactTestRenderer) {
  await act(async () =>
    byLabel(tree, ASK_COPY.examples[0])[0].props.onPress(),
  );
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
    question: "What is quorum?",
    phase: "done",
    step: null,
    preview: "",
    answer,
    failure: null,
  };
}
const sourceRow = (tree: ReactTestRenderer, number: number) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      String(node.props.accessibilityLabel).startsWith(`Source ${number}:`),
  )[0];

beforeEach(() => {
  vi.clearAllMocks();
  hooks.exchange = null;
  hooks.statusEnabled = [];
  hooks.savedUntil = null;
  gate.ensureConsent.mockResolvedValue(true);
  vi.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({
    type: "dismiss",
  } as never);
});

describe("AskSheet", () => {
  it("opens on example questions, and says it answers one at a time", () => {
    const text = screenText(render());
    expect(text).toContain(ASK_COPY.name);
    expect(text).toContain(ASK_COPY.empty_body);
    for (const example of ASK_COPY.examples) expect(text).toContain(example);
    expect(text).toContain(ASK_COPY.single_shot);
  });

  it("asks nothing of the server until the sheet is actually open", () => {
    const tree = render();
    expect(hooks.statusEnabled.every((enabled) => !enabled)).toBe(true);
    open(tree);
    expect(hooks.statusEnabled.at(-1)).toBe(true);
  });

  it("sends a question once the member has said yes", async () => {
    const tree = render();
    await askExample(tree);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.ask).toHaveBeenCalledWith(ASK_COPY.examples[0], {
      savedNoticeShown: false,
    });
  });

  it("says questions are saved, and only then tells the server it said so", async () => {
    hooks.savedUntil = "2026-11-26T12:00:00Z";
    const tree = render();
    open(tree);
    const text = screenText(tree);
    expect(text).toContain(askSavedLine("November 26, 2026"));
    expect(text).not.toContain(ASK_COPY.single_shot);
    await askExample(tree);
    expect(hooks.ask).toHaveBeenCalledWith(ASK_COPY.examples[0], {
      savedNoticeShown: true,
    });
  });

  it("sends nothing for a member who hasn't said yes, and offers the sheet again", async () => {
    gate.ensureConsent.mockResolvedValue(false);
    const tree = render();
    await askExample(tree);
    expect(hooks.ask).not.toHaveBeenCalled();
    const text = screenText(tree);
    expect(text).toContain(ASK_COPY.examples[0]);
    expect(text).toContain(askUnavailableLine("consent_required"));

    gate.ensureConsent.mockResolvedValue(true);
    await act(async () =>
      byLabel(tree, ASK_COPY.consent_action)[0].props.onPress(),
    );
    expect(hooks.ask).toHaveBeenCalledWith(ASK_COPY.examples[0], {
      savedNoticeShown: false,
    });
  });

  it("says it couldn't check, with Try again, when the member's answer can't be read", async () => {
    gate.ensureConsent.mockRejectedValue(new Error("Network request failed"));
    const tree = render();
    await askExample(tree);
    expect(hooks.ask).not.toHaveBeenCalled();
    expect(byLabel(tree, ASK_COPY.try_again)).toHaveLength(1);
  });

  it("opens a document over the sheet, so the answer is still there", async () => {
    hooks.exchange = answered();
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
    hooks.exchange = answered();
    hooks.download.mockRejectedValue(new Error("gone"));
    const tree = render();
    await act(async () => sourceRow(tree, 1).props.onPress());
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("That source didn't open. Try again.");
  });

  it("closes and opens the minutes screen for a minutes source", async () => {
    hooks.exchange = answered();
    const tree = render();
    await act(async () => sourceRow(tree, 2).props.onPress());
    expect(modal.dismiss).toHaveBeenCalled();
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/minutes-details?id=m1",
    );
  });

  it("drops a question still being answered when the sheet closes, and keeps a finished one", () => {
    const onClosed = vi.fn();
    hooks.exchange = { ...answered(), phase: "working", answer: null };
    const working = render(onClosed);
    act(() => sheet(working).props.onDismiss());
    expect(hooks.reset).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);

    hooks.reset.mockClear();
    hooks.exchange = answered();
    const done = render();
    act(() => sheet(done).props.onDismiss());
    expect(hooks.reset).not.toHaveBeenCalled();
  });

  it("can't send an empty question or a second one while the first is answered", () => {
    const empty = render();
    expect(byLabel(empty, ASK_COPY.send)[0].props.disabled).toBe(true);

    hooks.exchange = { ...answered(), phase: "working", answer: null };
    const working = render();
    const field = working.root.findAll(
      (node) => (node.type as unknown) === "BottomSheetTextInput",
    )[0];
    act(() => field.props.onChangeText("Another?"));
    expect(byLabel(working, ASK_COPY.send)[0].props.disabled).toBe(true);
  });
});
