/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { AskExchange } from "@repo/hooks";
import {
  ASK_COPY,
  askLeftOutLine,
  askSourceMetaLine,
  askUnavailableLine,
  type AskAnswer,
  type AskSource,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { AskExchangeCard } from "./answer-card";

/**
 * The Ask card's states (`spec/behavior/ai.md` § Ask; #450, #451). Every word
 * is read from `ASK_COPY`, the same object web reads, so the two can't drift.
 */

// A purple chapter: the card is fixed gold, so nothing here may read it.
const branding = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => {
    branding.read();
    return { accent: "#8B5CF6" };
  },
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
    question: "When are dues due?",
    phase: "done",
    step: null,
    preview: "",
    answer: null,
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
  props: Partial<React.ComponentProps<typeof AskExchangeCard>> = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AskExchangeCard
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

describe("AskExchangeCard", () => {
  it("names the step under the streamed words while it works", () => {
    const tree = render(
      exchange({ phase: "working", step: "reading", preview: "Dues are" }),
    );
    const text = screenText(tree);
    expect(text).toContain("Dues are");
    expect(text).toContain(
      (ASK_COPY.steps as Record<string, string>).reading ??
        ASK_COPY.steps.searching,
    );
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
    expect(screenText(refused)).not.toContain(ASK_COPY.sources);

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

  it("numbers each cited sentence and lists its source", () => {
    const props = handlers();
    const tree = render(exchange({ answer: answer() }), props);
    const text = screenText(tree);
    expect(text).toContain("Dues are due on the first.");
    expect(text).toContain(ASK_COPY.sources);
    expect(text).toContain("Bylaws");
    expect(text).toContain("Roster");

    // The marker and the row both open the source this build has a screen for.
    const markers = byLabel(tree, "Source 1: Bylaws");
    expect(markers[0].props.accessibilityRole).toBe("link");
    act(() => markers[0].props.onPress());
    const rows = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Source 1: Bylaws."),
    );
    act(() => rows[0].props.onPress());
    expect(props.onOpenSource).toHaveBeenCalledTimes(2);
    expect(props.onOpenSource).toHaveBeenLastCalledWith(BYLAWS);
  });

  it("lists a source with no screen as plain text, not a dead button", () => {
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

  it("says a row's link is being fetched without changing its height", () => {
    const tree = render(exchange({ answer: answer() }), {
      openingSourceId: "s1",
    });
    expect(screenText(tree)).toContain("Opening");
    expect(screenText(tree)).not.toContain(askSourceMetaLine(BYLAWS));
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

  it("never reads the chapter accent", () => {
    render(exchange({ answer: answer() }));
    expect(branding.read).not.toHaveBeenCalled();
  });
});

describe("askSourceMetaLine", () => {
  it("writes kind, place and the full date", () => {
    expect(askSourceMetaLine(BYLAWS)).toMatch(/· Article IV · September 1, 2026$/);
  });

  it("marks live data, and says its kind once when the title is the kind", () => {
    expect(askSourceMetaLine(ROSTER).endsWith(ASK_COPY.live)).toBe(true);
  });
});
