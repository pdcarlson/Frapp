/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pressable, Text } from "react-native";
import { AI_REPORT_COPY, aiReportAttachedLine } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * Report this on the phone (#4315, `spec/behavior/ai.md` § Stored AI text).
 * What matters: a member is told what goes with the report before Send, the
 * receipt goes back exactly as it came, and a member who can't report is
 * never offered it.
 */

const permissions = vi.hoisted(() => ({
  data: { permissions: ["ai:use"] } as unknown,
}));
const policy = vi.hoisted(() => ({
  data: { keeps_text: true } as unknown,
  isError: false,
}));
const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyPermissions: () => permissions,
  useAiReportPolicy: () => policy,
  useReportAi: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { useAiReport, type AiReportTarget } from "./report-ai-sheet";

const ANSWER: AiReportTarget = {
  subject: "ask_answer",
  subjectId: "11111111-1111-4111-8111-111111111111",
  receipt: "sealed-receipt",
};

const modal = { present: vi.fn(), dismiss: vi.fn() };
const options = {
  createNodeMock: (element: React.ReactElement) =>
    (element.type as unknown) === "BottomSheetModal" ? modal : null,
};

function Surface({ target }: { target: AiReportTarget }) {
  const reporting = useAiReport();
  return (
    <>
      {reporting.offered ? (
        <Pressable
          accessibilityLabel="open"
          onPress={() => reporting.report(target)}
        >
          <Text>
            {reporting.isReported(target) ? "is reported" : "not reported"}
          </Text>
        </Pressable>
      ) : null}
      {reporting.offered ? (
        <Pressable
          accessibilityLabel="open on wrong"
          onPress={() => reporting.report(target, "wrong")}
        >
          <Text>from a thumbs down</Text>
        </Pressable>
      ) : null}
      {reporting.reportSheet}
    </>
  );
}

function render(target: AiReportTarget = ANSWER): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Surface target={target} />
      </FrappThemeProvider>,
      options,
    );
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

/** Whether Send report is held, read off the pressable that draws it. */
const sendDisabled = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        "disabled" in node.props &&
        drawnText(node) === AI_REPORT_COPY.send,
    )
    .some((node) => node.props.disabled === true);

async function press(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    await button(tree, label)!.props.onPress();
  });
}

beforeEach(() => {
  permissions.data = { permissions: ["ai:use"] };
  policy.data = { keeps_text: true };
  policy.isError = false;
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ already_reported: false });
  modal.present.mockClear();
});

describe("Report this", () => {
  it("is not offered to a member without ai:use, or before that is known", () => {
    permissions.data = { permissions: ["tasks:view"] };
    expect(button(render(), "open")).toBeUndefined();
    permissions.data = undefined;
    const tree = render();
    expect(button(tree, "open")).toBeUndefined();
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "BottomSheetModal"),
    ).toHaveLength(0);
  });

  it("opens on the thing reported and says what goes with it before Send", async () => {
    const tree = render();
    await press(tree, "open");
    expect(modal.present).toHaveBeenCalledTimes(1);
    const text = screenText(tree);
    expect(text).toContain(AI_REPORT_COPY.titles.ask_answer);
    expect(text).toContain(AI_REPORT_COPY.who_reads);
    expect(text).toContain(aiReportAttachedLine("ask_answer", true));
  });

  it("holds Send until a reason is picked, then sends the receipt as it came", async () => {
    const tree = render();
    await press(tree, "open");
    expect(sendDisabled(tree)).toBe(true);
    expect(mutateAsync).not.toHaveBeenCalled();

    await press(tree, AI_REPORT_COPY.reasons.wrong);
    expect(sendDisabled(tree)).toBe(false);
    await press(tree, AI_REPORT_COPY.send);
    expect(mutateAsync).toHaveBeenCalledWith({
      subject: "ask_answer",
      subjectId: ANSWER.subjectId,
      reason: "wrong",
      note: "",
      receipt: "sealed-receipt",
    });
    expect(screenText(tree)).toContain(AI_REPORT_COPY.sent_title);
    expect(screenText(tree)).toContain("is reported");
  });

  it("opens on the reason a thumbs down already gave, and the next report does not", async () => {
    const tree = render();
    await press(tree, "open on wrong");
    expect(sendDisabled(tree)).toBe(false);
    // The member can still change it; the next thing reported starts empty.
    await press(tree, AI_REPORT_COPY.reasons.other);
    await press(tree, "open");
    expect(sendDisabled(tree)).toBe(true);
    await press(tree, "open on wrong");
    await press(tree, AI_REPORT_COPY.send);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "wrong" }),
    );
  });

  it("says a second report of the same thing was already in", async () => {
    mutateAsync.mockResolvedValue({ already_reported: true });
    const tree = render();
    await press(tree, "open");
    await press(tree, AI_REPORT_COPY.reasons.other);
    await press(tree, AI_REPORT_COPY.send);
    expect(screenText(tree)).toContain(AI_REPORT_COPY.already_title);
  });

  it("says only the reason and note are sent when the server keeps no text", async () => {
    policy.data = { keeps_text: false };
    const tree = render();
    await press(tree, "open");
    expect(screenText(tree)).toContain(aiReportAttachedLine("ask_answer", false));
  });

  it("says the same for an answer that came with no receipt", async () => {
    const tree = render({ ...ANSWER, receipt: null });
    await press(tree, "open");
    expect(screenText(tree)).toContain(aiReportAttachedLine("ask_answer", false));
  });

  it("waits for the server's word on what is kept before Send can be pressed", async () => {
    policy.data = undefined;
    const tree = render();
    await press(tree, "open");
    await press(tree, AI_REPORT_COPY.reasons.wrong);
    expect(sendDisabled(tree)).toBe(true);
    expect(screenText(tree)).not.toContain("Sent with your report");
  });

  it("says the most a report could keep when that word can't be read", async () => {
    policy.data = undefined;
    policy.isError = true;
    const tree = render();
    await press(tree, "open");
    expect(screenText(tree)).toContain(aiReportAttachedLine("ask_answer", true));
  });

  it.each([
    ["ai.report.too_old", AI_REPORT_COPY.too_old],
    ["ai.report.receipt_invalid", AI_REPORT_COPY.receipt_invalid],
    ["ai.report.not_found", AI_REPORT_COPY.gone],
    ["something.else", AI_REPORT_COPY.failed],
  ])("says why a report with %s didn't send, and stays unreported", async (code, line) => {
    mutateAsync.mockRejectedValue({ code });
    const tree = render();
    await press(tree, "open");
    await press(tree, AI_REPORT_COPY.reasons.wrong);
    await press(tree, AI_REPORT_COPY.send);
    expect(screenText(tree)).toContain(line);
    expect(screenText(tree)).toContain("not reported");
  });

  describe("a chat summary (#3946)", () => {
    const SUMMARY: AiReportTarget = {
      subject: "chat_summary",
      subjectId: "22222222-2222-4222-8222-222222222222",
      receipt: "sealed-summary",
    };

    it("says the summary goes with the report, and sends its receipt as it came", async () => {
      const tree = render(SUMMARY);
      await press(tree, "open");
      const text = screenText(tree);
      expect(text).toContain(AI_REPORT_COPY.titles.chat_summary);
      expect(text).toContain(aiReportAttachedLine("chat_summary", true));
      await press(tree, AI_REPORT_COPY.reasons.wrong);
      await press(tree, AI_REPORT_COPY.send);
      expect(mutateAsync).toHaveBeenCalledWith({
        subject: "chat_summary",
        subjectId: SUMMARY.subjectId,
        reason: "wrong",
        note: "",
        receipt: "sealed-summary",
      });
    });

    it("says only the reason and note are sent for a summary with no receipt", async () => {
      const tree = render({ ...SUMMARY, receipt: null });
      await press(tree, "open");
      expect(screenText(tree)).toContain(
        aiReportAttachedLine("chat_summary", false),
      );
    });

    it.each([
      ["ai.report.too_old", AI_REPORT_COPY.summary_too_old],
      ["ai.report.receipt_invalid", AI_REPORT_COPY.summary_receipt_invalid],
    ])("says a summary's own words when %s refuses it", async (code, line) => {
      mutateAsync.mockRejectedValue({ code });
      const tree = render(SUMMARY);
      await press(tree, "open");
      await press(tree, AI_REPORT_COPY.reasons.wrong);
      await press(tree, AI_REPORT_COPY.send);
      expect(screenText(tree)).toContain(line);
    });
  });

  it("tells one draft from the next under the same meeting", async () => {
    const first: AiReportTarget = {
      subject: "meeting_draft",
      subjectId: ANSWER.subjectId,
      version: "2026-11-12T01:00:00Z",
    };
    const tree = render(first);
    await press(tree, "open");
    await press(tree, AI_REPORT_COPY.reasons.wrong);
    await press(tree, AI_REPORT_COPY.send);
    expect(screenText(tree)).toContain("is reported");
    act(() => {
      tree.update(
        <FrappThemeProvider>
          <Surface target={{ ...first, version: "2026-11-12T02:00:00Z" }} />
        </FrappThemeProvider>,
      );
    });
    expect(screenText(tree)).toContain("not reported");
  });
});
