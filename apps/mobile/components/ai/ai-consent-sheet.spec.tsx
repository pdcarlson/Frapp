/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_CONSENT_COPY } from "@repo/validation";
import type { AiConsentState } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * The member's AI sheet and the gate in front of every AI feature on the
 * phone (#4308, `spec/behavior/ai.md` § Consent). Silence is No: only a
 * pressed Yes lets anything through.
 */

const consentQuery = vi.hoisted(() => ({
  data: undefined as unknown,
  refetch: vi.fn(),
}));
const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => consentQuery,
  useAnswerAiConsent: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { AiConsentSheet, useAiConsentGate } from "./ai-consent-sheet";

const CONSENT = {
  answer: null,
  answered_at: null,
  sheet_changed: false,
  sheet: {
    version: 2,
    providers: [
      { key: "anthropic", name: "Anthropic" },
      { key: "assemblyai", name: "AssemblyAI" },
    ],
    data: [
      { key: "questions", label: "Questions you ask" },
      { key: "notes", label: "Meeting notes you paste" },
    ],
  },
} as unknown as AiConsentState;

const modal = { present: vi.fn(), dismiss: vi.fn() };
const options = {
  createNodeMock: (element: React.ReactElement) =>
    (element.type as unknown) === "BottomSheetModal" ? modal : null,
};

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>, options);
  });
  return tree;
}

const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.onPress === "function" &&
      (node.props.accessibilityLabel === label || drawnText(node) === label),
  )[0];

const sheetNode = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "BottomSheetModal")[0];

beforeEach(() => {
  consentQuery.data = CONSENT;
  consentQuery.refetch.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  modal.present.mockClear();
  modal.dismiss.mockClear();
});

describe("AiConsentSheet", () => {
  it("names who the data goes to and what is sent, from the server's sheet", () => {
    const tree = render(<AiConsentSheet consent={CONSENT} />);
    const text = screenText(tree);
    expect(text).toContain(AI_CONSENT_COPY.title);
    expect(text).toContain(AI_CONSENT_COPY.intro("Anthropic and AssemblyAI"));
    expect(text).toContain("Questions you ask");
    expect(text).toContain("Meeting notes you paste");
    for (const line of AI_CONSENT_COPY.noMeans) expect(text).toContain(line);
    expect(text).toContain(AI_CONSENT_COPY.changeLater);
  });

  it("says the sheet changed, and not the answer it voided", () => {
    const tree = render(
      <AiConsentSheet
        consent={{
          ...CONSENT,
          sheet_changed: true,
          answer: "yes",
          answered_at: "2026-11-01T12:00:00Z",
        }}
      />,
    );
    const text = screenText(tree);
    expect(text).toContain(AI_CONSENT_COPY.titleChanged);
    expect(text).not.toContain("You said yes");
  });

  it("states a standing answer with its full date", () => {
    const tree = render(
      <AiConsentSheet
        consent={{
          ...CONSENT,
          answer: "no",
          answered_at: "2026-11-01T12:00:00Z",
        }}
      />,
    );
    expect(screenText(tree)).toContain(
      AI_CONSENT_COPY.answeredNo("November 1, 2026"),
    );
  });

  it.each([
    ["yes", AI_CONSENT_COPY.yes],
    ["no", AI_CONSENT_COPY.no],
  ] as const)("saves %s against the version shown", async (answer, label) => {
    const onAnswered = vi.fn();
    const tree = render(
      <AiConsentSheet consent={CONSENT} onAnswered={onAnswered} />,
    );
    await act(async () => button(tree, label).props.onPress());
    expect(mutateAsync).toHaveBeenCalledWith({ sheet_version: 2, answer });
    expect(onAnswered).toHaveBeenCalledWith(answer);
  });

  it("says a save failed in the footnote's place, and reports no answer", async () => {
    mutateAsync.mockRejectedValue(new Error("offline"));
    const onAnswered = vi.fn();
    const tree = render(
      <AiConsentSheet consent={CONSENT} onAnswered={onAnswered} />,
    );
    await act(async () => button(tree, AI_CONSENT_COPY.yes).props.onPress());
    expect(onAnswered).not.toHaveBeenCalled();
    expect(screenText(tree)).not.toContain(AI_CONSENT_COPY.changeLater);
  });
});

describe("useAiConsentGate", () => {
  let gate!: ReturnType<typeof useAiConsentGate>;
  function Host() {
    gate = useAiConsentGate();
    return <>{gate.consentSheet}</>;
  }

  it("lets a member who said yes straight through, with no sheet", async () => {
    consentQuery.data = { ...CONSENT, answer: "yes" };
    render(<Host />);
    await expect(gate.ensureConsent()).resolves.toBe(true);
    expect(modal.present).not.toHaveBeenCalled();
  });

  it("asks anyone else, and passes only on a pressed Yes", async () => {
    const tree = render(<Host />);
    const asked = gate.ensureConsent();
    expect(modal.present).toHaveBeenCalledTimes(1);
    await act(async () => button(tree, AI_CONSENT_COPY.yes).props.onPress());
    await expect(asked).resolves.toBe(true);
  });

  it("counts No, and swiping the sheet away, as no", async () => {
    const tree = render(<Host />);
    const declined = gate.ensureConsent();
    await act(async () => button(tree, AI_CONSENT_COPY.no).props.onPress());
    await expect(declined).resolves.toBe(false);

    const swiped = gate.ensureConsent();
    act(() => sheetNode(tree).props.onDismiss());
    await expect(swiped).resolves.toBe(false);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("counts a Yes that was still saving when the sheet was swiped away", async () => {
    let land!: () => void;
    mutateAsync.mockImplementation(
      () => new Promise<void>((resolve) => (land = () => resolve())),
    );
    const tree = render(<Host />);
    const asked = gate.ensureConsent();
    act(() => button(tree, AI_CONSENT_COPY.yes).props.onPress());
    act(() => sheetNode(tree).props.onDismiss());
    await act(async () => land());
    await expect(asked).resolves.toBe(true);
  });

  it("settles as no when a save that outlived the sheet fails", async () => {
    let fail!: () => void;
    mutateAsync.mockImplementation(
      () => new Promise<void>((_resolve, reject) => (fail = () => reject(new Error("x")))),
    );
    const tree = render(<Host />);
    const asked = gate.ensureConsent();
    act(() => button(tree, AI_CONSENT_COPY.yes).props.onPress());
    act(() => sheetNode(tree).props.onDismiss());
    await act(async () => fail());
    await expect(asked).resolves.toBe(false);
  });

  it("is a no, with no sheet, where the server has no AI", async () => {
    consentQuery.data = null;
    render(<Host />);
    await expect(gate.ensureConsent()).resolves.toBe(false);
    expect(modal.present).not.toHaveBeenCalled();
  });

  it("rejects when the answer can't be read, which is not a No", async () => {
    consentQuery.data = undefined;
    consentQuery.refetch.mockResolvedValue({
      data: undefined,
      error: new Error("offline"),
    });
    render(<Host />);
    await expect(gate.ensureConsent()).rejects.toThrow("offline");
  });
});
