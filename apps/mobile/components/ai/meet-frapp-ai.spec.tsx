/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FRAPP_AI_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * Meet Frapp AI on the phone (#4790, `spec/behavior/ai.md` § Consent): the
 * screen, and the gate in front of every AI feature. Only a pressed
 * Continue lets anything through.
 */

const choice = vi.hoisted(() => ({
  consent: undefined as unknown,
  consentFailed: false,
  readConsent: vi.fn(),
  providers: ["Anthropic", "Google"],
  forChapter: false,
  turnOn: vi.fn(),
  notNow: vi.fn(),
  pending: false,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useFrappAiChoice: () => choice,
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));

import { MeetFrappAiSheet, useAiConsentGate } from "./meet-frapp-ai";

const CONSENT = {
  answer: null,
  answered_at: null,
  sheet_changed: false,
  sheet: { version: 2, providers: [], data: [] },
};

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
  choice.consent = CONSENT;
  choice.forChapter = false;
  choice.readConsent.mockReset();
  choice.readConsent.mockImplementation(() => Promise.resolve(choice.consent));
  choice.turnOn.mockReset();
  choice.turnOn.mockResolvedValue(true);
  choice.notNow.mockReset();
  choice.notNow.mockResolvedValue(undefined);
  modal.present.mockClear();
  modal.dismiss.mockClear();
});

describe("MeetFrappAiSheet", () => {
  it("says what it does in three lines and names the companies in one", () => {
    const tree = render(<MeetFrappAiSheet />);
    const text = screenText(tree);
    expect(text).toContain(FRAPP_AI_COPY.title);
    for (const point of FRAPP_AI_COPY.points) expect(text).toContain(point.text);
    expect(text).toContain(
      FRAPP_AI_COPY.disclosure("Anthropic and Google", false),
    );
    expect(text).toContain(FRAPP_AI_COPY.privacyLink);
  });

  it("tells a president whose chapter never set its switches that it covers the chapter", () => {
    choice.forChapter = true;
    const tree = render(<MeetFrappAiSheet />);
    expect(screenText(tree)).toContain(
      FRAPP_AI_COPY.disclosure("Anthropic and Google", true),
    );
  });

  it("turns it on with Continue and records Not now", async () => {
    const onAnswered = vi.fn();
    const tree = render(<MeetFrappAiSheet onAnswered={onAnswered} />);
    await act(async () =>
      button(tree, FRAPP_AI_COPY.continue).props.onPress(),
    );
    expect(choice.turnOn).toHaveBeenCalledTimes(1);
    expect(onAnswered).toHaveBeenLastCalledWith(true);
    await act(async () => button(tree, FRAPP_AI_COPY.notNow).props.onPress());
    expect(choice.notNow).toHaveBeenCalledTimes(1);
    expect(onAnswered).toHaveBeenLastCalledWith(false);
  });

  it("says a failed Continue under the line, and reports no answer", async () => {
    choice.turnOn.mockRejectedValue(new Error("offline"));
    const onAnswered = vi.fn();
    const tree = render(<MeetFrappAiSheet onAnswered={onAnswered} />);
    await act(async () =>
      button(tree, FRAPP_AI_COPY.continue).props.onPress(),
    );
    expect(onAnswered).not.toHaveBeenCalled();
    expect(screenText(tree)).toMatch(/try again/i);
  });
});

describe("useAiConsentGate", () => {
  let gate!: ReturnType<typeof useAiConsentGate>;
  function Host() {
    gate = useAiConsentGate();
    return <>{gate.consentSheet}</>;
  }

  it("lets a member who has Frapp AI on straight through, with no sheet", async () => {
    choice.consent = { ...CONSENT, answer: "yes" };
    render(<Host />);
    await expect(gate.ensureConsent()).resolves.toBe(true);
    expect(modal.present).not.toHaveBeenCalled();
  });

  it("asks anyone else, and passes only on a pressed Continue", async () => {
    const tree = render(<Host />);
    const asked = gate.ensureConsent();
    await act(async () => {});
    expect(modal.present).toHaveBeenCalledTimes(1);
    await act(async () =>
      button(tree, FRAPP_AI_COPY.continue).props.onPress(),
    );
    await expect(asked).resolves.toBe(true);
  });

  it("counts Not now, and swiping the sheet away, as no", async () => {
    const tree = render(<Host />);
    const declined = gate.ensureConsent();
    await act(async () => {});
    await act(async () => button(tree, FRAPP_AI_COPY.notNow).props.onPress());
    await expect(declined).resolves.toBe(false);

    const swiped = gate.ensureConsent();
    await act(async () => {});
    act(() => sheetNode(tree).props.onDismiss());
    await expect(swiped).resolves.toBe(false);
    expect(choice.notNow).toHaveBeenCalledTimes(1);
  });

  it("counts a Continue that was still saving when the sheet was swiped away", async () => {
    let land!: () => void;
    choice.turnOn.mockImplementation(
      () => new Promise<boolean>((resolve) => (land = () => resolve(true))),
    );
    const tree = render(<Host />);
    const asked = gate.ensureConsent();
    await act(async () => {});
    act(() => button(tree, FRAPP_AI_COPY.continue).props.onPress());
    act(() => sheetNode(tree).props.onDismiss());
    await act(async () => land());
    await expect(asked).resolves.toBe(true);
  });

  it("is a no, with no sheet, where the server has no AI", async () => {
    choice.consent = null;
    render(<Host />);
    await expect(gate.ensureConsent()).resolves.toBe(false);
    expect(modal.present).not.toHaveBeenCalled();
  });

  it("rejects when the answer can't be read, which is not a No", async () => {
    choice.consent = undefined;
    choice.readConsent.mockRejectedValue(new Error("offline"));
    render(<Host />);
    await expect(gate.ensureConsent()).rejects.toThrow("offline");
  });
});
