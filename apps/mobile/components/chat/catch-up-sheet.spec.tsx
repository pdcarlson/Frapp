/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_REPORT_COPY,
  CHAT_CATCH_UP_COPY,
  askLeftOutLine,
  chatCatchUpNotes,
  chatCatchUpUnavailableLine,
  type ChatCatchUp,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Catch me up on the phone (#3946): what a member sees for each way a
 * summary can end, that nothing is sent before they have said yes, and that
 * a line opens its message while the summary waits to be come back to. The
 * screens' entry points are in `chat-thread-screen.spec.tsx` and
 * `message-thread-screen.spec.tsx`.
 */
const hooks = vi.hoisted(() => ({
  current: null as unknown,
  run: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChatCatchUp: () => ({
    current: hooks.current,
    run: hooks.run,
    reset: hooks.reset,
  }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#8E4EC6" }),
}));

const gate = vi.hoisted(() => ({ ensureConsent: vi.fn() }));
vi.mock("@/components/ai/ai-consent-sheet", () => ({
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

import { useCatchUp, type CatchUp, type CatchUpScope } from "./catch-up-sheet";

const modal = { present: vi.fn(), dismiss: vi.fn() };
const onOpenPoint = vi.fn();
let catchUp!: CatchUp;

function Harness({
  channelId,
  onValue,
}: {
  channelId: string;
  onValue: (value: CatchUp) => void;
}) {
  const value = useCatchUp({
    channelId,
    nameFor: (id) => (id === "u1" ? "Ana Ruiz" : null),
    onOpenPoint,
  });
  onValue(value);
  return value.sheets;
}
const keep = (value: CatchUp) => {
  catchUp = value;
};
const screen = (channelId: string) => (
  <FrappThemeProvider>
    <Harness channelId={channelId} onValue={keep} />
  </FrappThemeProvider>
);
function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(screen("c1"), {
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal" ? modal : null,
    });
  });
  return tree;
}
const sheet = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "BottomSheetModal")[0]!;
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );

const CHANNEL: CatchUpScope = {
  kind: "channel",
  channelId: "c1",
  channelName: "general",
  unread: { count: 60, as_of: "2026-11-12T15:00:00.000Z" },
};
const THREAD: CatchUpScope = {
  kind: "thread",
  channelId: "c1",
  channelName: "general",
  rootId: "m1",
};
const POINT = {
  kind: "for_you",
  text: "Ana asked you to bring the banner.",
  message_id: "m7",
  thread_root_id: null,
  author_id: "u1",
  sent_at: new Date().toISOString(),
  quote: "bring the banner",
};
function summary(over: Partial<ChatCatchUp> = {}): ChatCatchUp {
  return {
    status: "summarized",
    reason: null,
    points: [
      POINT,
      { ...POINT, kind: "decision", text: "Formal is April 12.", message_id: "m8" },
    ],
    messages_read: 60,
    messages_total: 60,
    left_out_messages: 0,
    unverified_points: 0,
    covers_from: null,
    covers_to: null,
    summary_id: "sum-1",
    report_receipt: "sealed",
    ...over,
  } as ChatCatchUp;
}
const done = (over?: Partial<ChatCatchUp>) => ({
  channelId: "c1",
  phase: "done",
  summary: summary(over),
  failure: null,
});
async function start(tree: ReactTestRenderer, scope: CatchUpScope) {
  await act(async () => catchUp.start(scope));
  return tree;
}
function show(tree: ReactTestRenderer, current: unknown) {
  hooks.current = current;
  act(() => tree.update(screen("c1")));
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.current = null;
  hooks.run.mockResolvedValue(undefined);
  gate.ensureConsent.mockResolvedValue(true);
  reporting.offered = true;
  reporting.reported = false;
});

describe("Catch me up", () => {
  it("asks for the new stretch straight away, by the count it was opened with", async () => {
    const tree = await start(render(), CHANNEL);
    expect(modal.present).toHaveBeenCalledTimes(1);
    expect(gate.ensureConsent).toHaveBeenCalledTimes(1);
    expect(hooks.run).toHaveBeenCalledWith("c1", {
      unread: { count: 60, as_of: "2026-11-12T15:00:00.000Z" },
    });
    const text = screenText(tree);
    expect(text).toContain(CHAT_CATCH_UP_COPY.name);
    expect(text).toContain("#general");
    expect(text).toContain(CHAT_CATCH_UP_COPY.private);
    expect(catchUp.active).toBe(true);
    expect(catchUp.waiting).toBe(false);
  });

  it("asks for the last 24 hours when nothing was new, and offers no New messages range", async () => {
    const tree = await start(render(), { ...CHANNEL, unread: null });
    expect(hooks.run).toHaveBeenCalledWith("c1", {
      since: expect.any(String),
    });
    const range = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === CHAT_CATCH_UP_COPY.range_label &&
        Array.isArray(node.props.options),
    )[0]!;
    expect(
      range.props.options.map((option: { value: string }) => option.value),
    ).toEqual(["day", "week"]);

    await act(async () => range.props.onChange("week"));
    expect(hooks.run).toHaveBeenCalledTimes(2);
  });

  it("asks for a thread by its parent, with no range to pick", async () => {
    const tree = await start(render(), THREAD);
    expect(hooks.run).toHaveBeenCalledWith("c1", { thread_root_id: "m1" });
    expect(screenText(tree)).toContain(CHAT_CATCH_UP_COPY.thread_title);
    expect(
      tree.root.findAll(
        (node) =>
          node.props.accessibilityLabel === CHAT_CATCH_UP_COPY.range_label,
      ),
    ).toHaveLength(0);
  });

  it("sends nothing for a member who hasn't said yes, and offers the sheet again", async () => {
    gate.ensureConsent.mockResolvedValue(false);
    const tree = await start(render(), CHANNEL);
    expect(hooks.run).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(
      chatCatchUpUnavailableLine("consent_required"),
    );

    gate.ensureConsent.mockResolvedValue(true);
    await act(async () =>
      byLabel(tree, CHAT_CATCH_UP_COPY.consent_action)[0]!.props.onPress(),
    );
    expect(hooks.run).toHaveBeenCalledTimes(1);
  });

  it("says it couldn't check, with Try again, when the member's answer can't be read", async () => {
    gate.ensureConsent.mockRejectedValue(new Error("Network request failed"));
    const tree = await start(render(), CHANNEL);
    expect(hooks.run).not.toHaveBeenCalled();
    expect(byLabel(tree, CHAT_CATCH_UP_COPY.try_again)).toHaveLength(1);
  });

  it("holds its place while it works", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, { channelId: "c1", phase: "working", summary: null, failure: null });
    expect(screenText(tree)).toContain(CHAT_CATCH_UP_COPY.working);
  });

  it("groups the points, names who and when, and says what it read", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done({ left_out_messages: 3 }));
    const text = screenText(tree);
    expect(text).toContain(CHAT_CATCH_UP_COPY.groups.for_you);
    expect(text).toContain(CHAT_CATCH_UP_COPY.groups.decision);
    expect(text).not.toContain(CHAT_CATCH_UP_COPY.groups.topic);
    expect(text).toContain("Ana asked you to bring the banner.");
    expect(text).toContain("Ana Ruiz");
    for (const note of chatCatchUpNotes(summary({ left_out_messages: 3 }))) {
      expect(text).toContain(note);
    }
    // How many messages were left out, never whose.
    expect(text).toContain(askLeftOutLine(3));
  });

  it("opens a line's message, and waits to be come back to without asking again", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done());
    const line = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith(POINT.text),
    )[0]!;
    act(() => line.props.onPress());
    expect(modal.dismiss).toHaveBeenCalledTimes(1);
    expect(onOpenPoint).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: "m7" }),
    );
    // The sheet finishes closing: the summary is kept.
    act(() => sheet(tree).props.onDismiss());
    expect(hooks.reset).toHaveBeenCalledTimes(1); // the one `start` made
    expect(catchUp.waiting).toBe(true);
    expect(catchUp.active).toBe(true);

    act(() => catchUp.resume());
    expect(modal.present).toHaveBeenCalledTimes(2);
    expect(hooks.run).toHaveBeenCalledTimes(1);
    expect(catchUp.waiting).toBe(false);
    expect(screenText(tree)).toContain(POINT.text);
  });

  it("ends the summary when the sheet is swiped away", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done());
    hooks.reset.mockClear();
    act(() => sheet(tree).props.onDismiss());
    expect(hooks.reset).toHaveBeenCalledTimes(1);
    expect(catchUp.active).toBe(false);
    expect(catchUp.waiting).toBe(false);
  });

  it("drops a waiting summary from the strip's ×", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done());
    act(() => catchUp.resume());
    hooks.reset.mockClear();
    act(() => catchUp.drop());
    expect(hooks.reset).toHaveBeenCalledTimes(1);
    expect(catchUp.active).toBe(false);
    void tree;
  });

  it("drops the summary, and any request, when the channel changes under it", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done());
    hooks.reset.mockClear();
    act(() => tree.update(screen("c2")));
    expect(hooks.reset).toHaveBeenCalled();
    expect(modal.dismiss).toHaveBeenCalled();
    expect(catchUp.active).toBe(false);
  });

  it("never shows another channel's summary", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, { ...done(), channelId: "other" });
    expect(screenText(tree)).not.toContain(POINT.text);
  });

  it("summarizes again on request", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done());
    await act(async () =>
      byLabel(tree, CHAT_CATCH_UP_COPY.again)[0]!.props.onPress(),
    );
    expect(hooks.run).toHaveBeenCalledTimes(2);
  });

  it("reports a summary by its id, with the receipt exactly as it came", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done());
    act(() => byLabel(tree, AI_REPORT_COPY.action)[0]!.props.onPress());
    expect(reporting.report).toHaveBeenCalledWith({
      subject: "chat_summary",
      subjectId: "sum-1",
      receipt: "sealed",
    });
  });

  it("offers no report to a member who can't send one, or on a summary with no id", async () => {
    reporting.offered = false;
    const tree = await start(render(), CHANNEL);
    show(tree, done());
    expect(byLabel(tree, AI_REPORT_COPY.action)).toHaveLength(0);

    reporting.offered = true;
    show(tree, done({ summary_id: null }));
    expect(byLabel(tree, AI_REPORT_COPY.action)).toHaveLength(0);
  });

  it("says each other ending in words", async () => {
    const tree = await start(render(), CHANNEL);
    show(tree, done({ status: "nothing_new", points: [] }));
    expect(screenText(tree)).toContain(CHAT_CATCH_UP_COPY.nothing_new);

    show(tree, done({ status: "refused", points: [] }));
    expect(screenText(tree)).toContain(CHAT_CATCH_UP_COPY.refused);

    show(tree, done({ status: "not_found", points: [] }));
    expect(screenText(tree)).toContain(CHAT_CATCH_UP_COPY.not_found);

    show(tree, done({ status: "unavailable", reason: "chat_off", points: [] }));
    expect(screenText(tree)).toContain(chatCatchUpUnavailableLine("chat_off"));

    show(tree, {
      channelId: "c1",
      phase: "failed",
      summary: null,
      failure: "That didn't go through. Try again.",
    });
    expect(screenText(tree)).toContain("That didn't go through. Try again.");
    expect(byLabel(tree, CHAT_CATCH_UP_COPY.try_again)).toHaveLength(1);
  });
});
