/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Text } from "react-native";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import * as Clipboard from "expo-clipboard";
import { describe, expect, it, vi } from "vitest";
import type { AskExchange } from "@repo/hooks";
import {
  AI_REPORT_COPY,
  ASK_COPY,
  ASK_FEEDBACK_COPY,
  askLeftOutLine,
  askReadLine,
  askSourceMetaLine,
  askUnavailableLine,
  type AskAnswer,
  type AskSource,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { AskTurn } from "./ask-turn";

/**
 * One turn of the Ask conversation (`spec/behavior/ai.md` § Ask; #450, #451).
 * Every word is read from `ASK_COPY`, the same object web reads, so the two
 * can't drift.
 */

// The reader has #rush-week (c1) and no other channel.
const channelList = vi.hoisted(() => ({ reads: 0 }));
// The thumbs hook has its own spec (`use-ask-feedback.spec.tsx`); here it is
// what the row draws from, and it is only called for a traced answer.
const thumbs = vi.hoisted(() => ({
  state: { rating: null, reason: null } as {
    rating: "up" | "down" | null;
    reason: string | null;
  },
  failed: false,
  asked: [] as (string | null | undefined)[],
  rate: vi.fn(),
  giveReason: vi.fn(),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChannels: () => {
    channelList.reads += 1;
    return { data: [{ id: "c1", name: "rush-week", type: "PUBLIC" }] };
  },
  useAskThumbs: (askId: string | null | undefined) => {
    thumbs.asked.push(askId);
    return {
      state: thumbs.state,
      failed: thumbs.failed,
      rate: thumbs.rate,
      giveReason: thumbs.giveReason,
    };
  },
}));

// A purple chapter: the member's bubble takes its solid accent pair, and
// nothing that is Frapp's (a marker, a chip's number) may.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#8B5CF6",
    accentPrimary: "#7C3AED",
    accentOnPrimary: "#FFFFFF",
  }),
}));

const BYLAWS: AskSource = {
  id: "s1",
  kind: "document",
  title: "Bylaws",
  detail: "Article IV",
  date: "2026-09-01T12:00:00Z",
  target: { type: "document", document_id: "d1", page: 2 },
};
const ROSTER: AskSource = {
  id: "s2",
  kind: "members",
  title: "Roster",
  detail: null,
  date: null,
  target: { type: "poll" },
};

function answer(over: Partial<AskAnswer> = {}): AskAnswer {
  return {
    status: "answered",
    reason: null,
    text: "Dues are due on the first. Ana is treasurer.",
    citations: [
      { source: 0, at: 26, quote: "due on the first" },
      { source: 1, at: 44, quote: "treasurer" },
    ],
    sources: [BYLAWS, ROSTER],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
    ...over,
  };
}

function exchange(over: Partial<AskExchange>): AskExchange {
  return {
    id: "turn-1",
    question: "When are dues due?",
    phase: "done",
    step: null,
    preview: "",
    answer: null,
    proposal: null,
    resolution: null,
    failure: null,
    ...over,
  };
}

const handlers = () => ({
  onOpenSource: vi.fn(),
  onRetry: vi.fn(),
  onAnswerConsent: vi.fn(),
});

function render(
  value: AskExchange,
  props: Partial<React.ComponentProps<typeof AskTurn>> = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AskTurn
          exchange={value}
          // Only the document has a screen in this build.
          canOpen={(source) => source.id === "s1"}
          {...handlers()}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  );

describe("AskTurn", () => {
  it("shows what the member typed above what came back", () => {
    const text = screenText(render(exchange({ answer: answer() })));
    expect(text.indexOf("When are dues due?")).toBeLessThan(
      text.indexOf("Dues are due on the first."),
    );
  });

  it("shows the card in the answer's place for a turn that asked for something", () => {
    const card = <Text>the card</Text>;
    const asked = exchange({ proposal: { status: "proposed" } as never });
    expect(screenText(render(asked, { proposal: card }))).toContain("the card");
    // Never while the turn is still working, and never beside an answer.
    expect(
      screenText(
        render(exchange({ phase: "working", step: "searching" }), {
          proposal: card,
        }),
      ),
    ).not.toContain("the card");
    expect(
      screenText(render(exchange({ answer: answer() }), { proposal: card })),
    ).not.toContain("the card");
  });

  it("names the step under the streamed words while it works", () => {
    const tree = render(
      exchange({ phase: "working", step: "reading", preview: "Dues are" }),
    );
    const text = screenText(tree);
    expect(text).toContain("Dues are");
    expect(text).toContain(ASK_COPY.steps.reading);
  });

  it("says what is being read, and that a card is being worked out", () => {
    const reading = render(
      exchange({
        phase: "working",
        step: "reading",
        stepDetail: { reads: ["events", "my_tasks"], found: 3 },
      }),
    );
    expect(screenText(reading)).toContain(
      "Reading the events calendar, your tasks and 3 sources",
    );
    const proposing = render(exchange({ phase: "working", step: "proposing" }));
    expect(screenText(proposing)).toContain(ASK_COPY.steps.proposing);
  });

  it("says nothing under a turn that has not been sent yet", () => {
    // The AI question is still open: no search has started.
    const tree = render(exchange({ phase: "working", step: null }));
    expect(screenText(tree)).not.toContain(ASK_COPY.steps.searching);
  });

  it("falls back to the searching line for a step this build doesn't know", () => {
    const tree = render(exchange({ phase: "working", step: "pondering" }));
    expect(screenText(tree)).toContain(ASK_COPY.steps.searching);
  });

  it("offers Try again only for a failure that may not repeat", () => {
    const props = handlers();
    const retryable = render(
      exchange({
        phase: "failed",
        failure: { message: "Couldn't reach Frapp.", retryable: true },
      }),
      props,
    );
    expect(screenText(retryable)).toContain("Couldn't reach Frapp.");
    act(() => byLabel(retryable, ASK_COPY.try_again)[0].props.onPress());
    expect(props.onRetry).toHaveBeenCalledTimes(1);

    const final = render(
      exchange({
        phase: "failed",
        failure: { message: "That question is too long.", retryable: false },
      }),
    );
    expect(byLabel(final, ASK_COPY.try_again)).toHaveLength(0);
  });

  it("says why Ask is unavailable, and offers the consent sheet only for no consent", () => {
    const props = handlers();
    const consent = render(
      exchange({
        answer: answer({ status: "unavailable", reason: "consent_required" }),
      }),
      props,
    );
    expect(screenText(consent)).toContain(
      askUnavailableLine("consent_required"),
    );
    act(() => byLabel(consent, ASK_COPY.consent_action)[0].props.onPress());
    expect(props.onAnswerConsent).toHaveBeenCalledTimes(1);

    const capped = render(
      exchange({
        answer: answer({ status: "unavailable", reason: "over_cap" }),
      }),
    );
    expect(screenText(capped)).toContain(askUnavailableLine("over_cap"));
    expect(byLabel(capped, ASK_COPY.consent_action)).toHaveLength(0);
  });

  it("states a refusal and a miss in plain words, with no sources", () => {
    const refused = render(exchange({ answer: answer({ status: "refused" }) }));
    expect(screenText(refused)).toContain(ASK_COPY.refused);
    expect(
      refused.root.findAll((node) =>
        String(node.props.accessibilityLabel).startsWith("Source "),
      ),
    ).toHaveLength(0);

    const missed = render(
      exchange({
        answer: answer({ status: "not_found", left_out_messages: 2 }),
      }),
    );
    expect(screenText(missed)).toContain(ASK_COPY.not_found);
    expect(screenText(missed)).toContain(ASK_COPY.not_found_hint);
    // What was left out explains a miss, so it is said here too.
    expect(screenText(missed)).toContain(askLeftOutLine(2));
  });

  it("numbers each cited sentence and gives each source a chip", () => {
    const props = handlers();
    const tree = render(exchange({ answer: answer() }), props);
    const text = screenText(tree);
    expect(text).toContain("Dues are due on the first.");
    expect(text).toContain("Bylaws");
    expect(text).toContain("Roster");

    // The marker and the chip both open the source this build has a screen for.
    const markers = byLabel(tree, "Source 1: Bylaws");
    expect(markers[0].props.accessibilityRole).toBe("link");
    act(() => markers[0].props.onPress());
    const chips = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        // What kind of source and its date are in the chip's spoken name.
        node.props.accessibilityLabel ===
          `Source 1: Bylaws. ${askSourceMetaLine(BYLAWS)}`,
    );
    act(() => chips[0].props.onPress());
    expect(props.onOpenSource).toHaveBeenCalledTimes(2);
    expect(props.onOpenSource).toHaveBeenLastCalledWith(BYLAWS);
  });

  it("says whose message a chat source is and when, on its chip (#4904)", () => {
    const chat: AskSource = {
      id: "s1",
      kind: "chat",
      title: "#general",
      detail: null,
      date: "2026-11-09T12:00:00.000Z",
      target: { type: "message", channel_id: "c1", message_id: "m1" },
      author: "Sam Ortiz",
    };
    const tree = render(
      exchange({ answer: answer({ sources: [chat, ROSTER] }) }),
    );
    const chip = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith(
          "Source 1: Sam Ortiz in #general. ",
        ),
    );
    expect(chip).toHaveLength(1);
    const text = screenText(tree);
    expect(text).toContain("Sam Ortiz in #general");
    expect(text).toContain("November 9, 2026");
    // The marker in the sentence says whose too.
    expect(byLabel(tree, "Source 1: Sam Ortiz in #general").length).toBe(1);
  });

  it("draws a source with no screen as a plain chip, not a dead button", () => {
    const tree = render(exchange({ answer: answer() }));
    const marker = byLabel(tree, "Source 2: Roster")[0];
    expect(marker.props.accessibilityRole).toBeUndefined();
    expect(marker.props.onPress).toBeUndefined();
    const pressable = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Source 2"),
    );
    expect(pressable).toHaveLength(0);
  });

  it("marks a chip busy while its link is fetched, without changing its words", () => {
    const tree = render(exchange({ answer: answer() }), {
      openingSourceId: "s1",
    });
    const chip = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Source 1: Bylaws."),
    )[0];
    expect(chip.props.accessibilityState).toEqual({ busy: true });
    expect(screenText(tree)).toContain("Bylaws");
  });

  it("says what the member should know before relying on the answer", () => {
    const tree = render(
      exchange({
        answer: answer({
          unverified_citations: 1,
          truncated: true,
          left_out_messages: 3,
        }),
      }),
    );
    const text = screenText(tree);
    expect(text).toContain(ASK_COPY.unverified);
    expect(text).toContain(ASK_COPY.truncated);
    expect(text).toContain(askLeftOutLine(3));
  });

  it("draws the member's bubble in the chapter's colour and leaves Frapp's marks gold (#4702)", () => {
    const tree = render(exchange({ answer: answer() }));
    const flat = (style: unknown): Record<string, unknown> =>
      Object.assign({}, ...[style].flat(Infinity as 1).filter(Boolean));
    const painted = tree.root
      .findAll((node) => node.props.style !== undefined)
      .map((node) => ({ node, style: flat(node.props.style) }));
    const question = tree.root.findAllByProps({ accessibilityRole: "header" })[0]!;
    const within = (node: ReactTestInstance) => {
      for (let at: ReactTestInstance | null = question; at; at = at.parent) {
        if (at === node) return true;
      }
      return false;
    };

    // The question's words are the accent's own text colour, on its fill.
    expect(flat(question.props.style).color).toBe("#FFFFFF");
    const filled = painted.filter((p) => p.style.backgroundColor === "#7C3AED");
    expect(filled.length).toBeGreaterThan(0);
    // Nothing but the bubble is filled with it, and nothing reads the accent
    // text role at all.
    expect(filled.every((p) => within(p.node))).toBe(true);
    const colours = painted
      .flatMap((p) => [p.style.color, p.style.backgroundColor])
      .map((value) => String(value).toUpperCase());
    expect(colours).not.toContain("#8B5CF6");
    // The marker keeps Ask's gold.
    expect(colours).toContain("#F4CB63");
  });
});

describe("people and channels an answer names (#4904)", () => {
  const named = (entities: unknown) =>
    exchange({
      answer: {
        ...answer({
          text: "Ask @Ana Ruiz in #rush-week, not @Nobody.",
          citations: [],
          sources: [],
        }),
        entities,
      } as AskAnswer,
    });
  const ENTITIES = [
    { type: "member", id: "u1", name: "Ana Ruiz" },
    { type: "channel", id: "c1", name: "rush-week" },
  ];
  const ELSEWHERE = [{ type: "channel", id: "c9", name: "rush-week" }];
  const runs = (tree: ReactTestRenderer, text: string) =>
    tree.root.findAll(
      (node) => node.type === Text && node.props.children === text,
    );
  const filled = (node: ReactTestInstance) =>
    Boolean(
      (node.props.style as { backgroundColor?: string } | undefined)
        ?.backgroundColor,
    );

  it("highlights a listed member and links a channel the reader has", () => {
    const onOpenChannel = vi.fn();
    const tree = render(named(ENTITIES), { onOpenChannel });

    const [member] = runs(tree, "@Ana Ruiz");
    expect(filled(member)).toBe(true);
    expect(member.props.onPress).toBeUndefined();

    const [channel] = runs(tree, "#rush-week");
    expect(channel.props.accessibilityRole).toBe("link");
    act(() => channel.props.onPress());
    expect(onOpenChannel).toHaveBeenCalledWith("c1");

    // A name the server did not list is ordinary text.
    expect(runs(tree, "@Nobody")).toHaveLength(0);
  });

  it("leaves a channel the reader cannot open as plain words", () => {
    const tree = render(named(ELSEWHERE), { onOpenChannel: vi.fn() });
    const [channel] = runs(tree, "#rush-week");
    expect(channel.props.accessibilityRole).toBeUndefined();
    expect(channel.props.onPress).toBeUndefined();
    expect(filled(channel)).toBe(false);
  });

  it("draws an answer with no list as it always was, without reading the channel list", () => {
    channelList.reads = 0;
    const tree = render(named(undefined), { onOpenChannel: vi.fn() });
    expect(channelList.reads).toBe(0);
    expect(runs(tree, "@Ana Ruiz")).toHaveLength(0);
    expect(
      runs(tree, "Ask @Ana Ruiz in #rush-week, not @Nobody."),
    ).toHaveLength(1);
  });
});

describe("askSourceMetaLine", () => {
  it("writes kind, place and the full date", () => {
    expect(askSourceMetaLine(BYLAWS)).toMatch(
      /· Article IV · September 1, 2026$/,
    );
  });

  it("marks live data, and says its kind once when the title is the kind", () => {
    expect(askSourceMetaLine(ROSTER).endsWith(ASK_COPY.live)).toBe(true);
  });
});

describe("under an answer", () => {
  const REPORT = AI_REPORT_COPY.titles.ask_answer;

  it("draws Report last as a quiet icon, only for something Ask wrote, and Reported once sent", () => {
    const onPress = vi.fn();
    const done = exchange({ answer: answer(), askId: "ask-1" });
    const tree = render(done, { report: { reported: false, onPress } });
    act(() => byLabel(tree, REPORT)[0]!.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    // Paul, 2026-11-13: Report is not the answer's one loud control. Its
    // words are for a screen reader, and are not on screen.
    expect(screenText(tree)).not.toContain(AI_REPORT_COPY.action);

    const sent = render(done, { report: { reported: true, onPress } });
    expect(byLabel(sent, AI_REPORT_COPY.reported)[0]!.props.disabled).toBe(
      true,
    );

    // Nothing AI-made in an answer that was never attempted, or not yet named.
    expect(
      byLabel(
        render(
          exchange({
            askId: "ask-1",
            answer: answer({ status: "unavailable", reason: "chapter_off" }),
          }),
          { report: { reported: false, onPress } },
        ),
        REPORT,
      ),
    ).toHaveLength(0);
    expect(
      byLabel(
        render(exchange({ answer: answer() }), {
          report: { reported: false, onPress },
        }),
        REPORT,
      ),
    ).toHaveLength(0);
    expect(byLabel(render(done), REPORT)).toHaveLength(0);
  });

  it("copies the answer's words and says so, and has nothing to copy where there are none", async () => {
    const tree = render(exchange({ answer: answer(), askId: "ask-1" }));
    await act(async () => {
      byLabel(tree, ASK_COPY.copy_answer)[0]!.props.onPress();
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      "Dues are due on the first. Ana is treasurer.",
    );
    expect(byLabel(tree, ASK_COPY.copied_answer)).not.toHaveLength(0);

    const miss = render(
      exchange({
        askId: "ask-2",
        answer: answer({ status: "not_found", text: "", sources: [] }),
      }),
    );
    expect(byLabel(miss, ASK_COPY.copy_answer)).toHaveLength(0);
  });

  it("says what Frapp read, after the answer and before its sources", () => {
    const tree = render(
      exchange({
        answer: answer(),
        askId: "ask-1",
        read: { reads: ["events"], found: 2 },
      }),
    );
    const text = screenText(tree);
    const line = askReadLine({ reads: ["events"], found: 2 })!;
    expect(text).toContain(line);
    expect(text.indexOf("Ana is treasurer")).toBeLessThan(text.indexOf(line));
    expect(text.indexOf(line)).toBeLessThan(text.lastIndexOf("Bylaws"));
    // And no line when the server named nothing it read.
    expect(screenText(render(exchange({ answer: answer() })))).not.toMatch(
      /Read the /,
    );
  });
});

describe("thumbs under an answer (#4904)", () => {
  const traced = exchange({
    askId: "ask-1",
    answer: answer({ ask_id: "trace-1" }),
  });
  const show = (
    rating: "up" | "down" | null,
    reason: string | null = null,
    report: React.ComponentProps<typeof AskTurn>["report"] = null,
  ) => {
    thumbs.state = { rating, reason };
    thumbs.failed = false;
    thumbs.asked.length = 0;
    thumbs.rate.mockClear();
    thumbs.giveReason.mockClear();
    return render(traced, { report });
  };

  it("are not drawn, and nothing is asked of the server, without a kept trace", () => {
    thumbs.asked.length = 0;
    const tree = render(exchange({ askId: "ask-1", answer: answer() }));
    expect(byLabel(tree, ASK_FEEDBACK_COPY.up)).toHaveLength(0);
    expect(byLabel(tree, ASK_FEEDBACK_COPY.down)).toHaveLength(0);
    expect(thumbs.asked).toHaveLength(0);
  });

  it("rate against the kept trace's id, not the turn's", () => {
    const tree = show(null);
    expect(thumbs.asked).toContain("trace-1");
    act(() => byLabel(tree, ASK_FEEDBACK_COPY.down)[0]!.props.onPress());
    expect(thumbs.rate).toHaveBeenCalledWith("down");
    expect(screenText(tree)).not.toContain(ASK_FEEDBACK_COPY.thanks);
  });

  it("thank an up and say it is selected", () => {
    const tree = show("up");
    expect(
      byLabel(tree, ASK_FEEDBACK_COPY.up)[0]!.props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(screenText(tree)).toContain(ASK_FEEDBACK_COPY.thanks);
    expect(screenText(tree)).not.toContain(ASK_FEEDBACK_COPY.prompt);
  });

  it("ask why on a down in one tap, and offer to send on the reason given", () => {
    const onSend = vi.fn();
    const tree = show("down", "wrong", {
      reported: false,
      onPress: vi.fn(),
      onSend,
    });
    expect(screenText(tree)).toContain(ASK_FEEDBACK_COPY.prompt);
    act(() =>
      byLabel(tree, ASK_FEEDBACK_COPY.reasons.missed)[0]!.props.onPress(),
    );
    expect(thumbs.giveReason).toHaveBeenCalledWith("missed");
    expect(screenText(tree)).toContain(ASK_FEEDBACK_COPY.send.line);
    const send = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.onPress === "function" &&
        screenText({ root: node } as never).includes(
          ASK_FEEDBACK_COPY.send.action,
        ) &&
        !screenText({ root: node } as never).includes(
          ASK_FEEDBACK_COPY.prompt,
        ),
    )[0]!;
    act(() => send.props.onPress());
    expect(onSend).toHaveBeenCalledWith("wrong");
  });

  it("offer no send to a member who cannot report, or once it is reported", () => {
    expect(screenText(show("down"))).not.toContain(
      ASK_FEEDBACK_COPY.send.action,
    );
    const reported = show("down", null, {
      reported: true,
      onPress: vi.fn(),
      onSend: vi.fn(),
    });
    expect(screenText(reported)).not.toContain(ASK_FEEDBACK_COPY.send.action);
    // The reasons stay: the rating is still the member's to explain.
    expect(screenText(reported)).toContain(ASK_FEEDBACK_COPY.prompt);
  });

  it("say so when a rating did not send", () => {
    thumbs.state = { rating: null, reason: null };
    thumbs.failed = true;
    const tree = render(traced);
    expect(screenText(tree)).toContain(ASK_FEEDBACK_COPY.failed);
    thumbs.failed = false;
  });
});
