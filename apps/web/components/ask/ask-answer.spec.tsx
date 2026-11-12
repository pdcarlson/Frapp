import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AskExchange } from "@repo/hooks";
import { AI_REPORT_COPY, ASK_COPY, type AskAnswer } from "@repo/validation";

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyPermissions: () => ({ data: { permissions: ["ai:use"] } }),
}));

const { AskExchangeView } = await import("./ask-answer");
import { askSourceHref } from "./ask-source-link";

/**
 * An answer on screen (#451): each cited sentence carries a marker that opens
 * its source, the sources are listed under it, and an answer with nothing
 * behind it says so instead of showing text.
 */

const ANSWER: AskAnswer = {
  status: "answered",
  reason: null,
  text: "Quorum is two-thirds. Sam has the van keys.",
  citations: [
    { source: 0, at: 21, quote: "two-thirds of active members" },
    { source: 1, at: 43, quote: "I have the van keys" },
    { source: 2, at: 43, quote: "Treasurer: Lee" },
  ],
  sources: [
    {
      id: "s1",
      kind: "document",
      title: "Bylaws",
      detail: "Article IV",
      date: "2026-01-10T12:00:00.000Z",
      target: { type: "document", document_id: "d1", page: 3 },
    },
    {
      id: "s2",
      kind: "chat",
      title: "#general",
      detail: null,
      date: "2026-11-09T12:00:00.000Z",
      target: { type: "message", channel_id: "c1", message_id: "m1" },
    },
    {
      id: "s3",
      kind: "hologram",
      title: "Something newer",
      detail: null,
      date: null,
      target: { type: "hologram", id: "h1" },
    },
  ],
  left_out_messages: 0,
  unverified_citations: 0,
  truncated: false,
  saved: false,
};

const exchange = (overrides: Partial<AskExchange> = {}): AskExchange => ({
  question: "What is quorum?",
  phase: "done",
  step: null,
  preview: "",
  answer: ANSWER,
  failure: null,
  ...overrides,
});

const show = (
  value: AskExchange,
  handlers: { retry?: () => void; consent?: () => void } = {},
) =>
  render(
    <AskExchangeView
      exchange={value}
      onRetry={handlers.retry ?? (() => undefined)}
      onAnswerConsent={handlers.consent ?? (() => undefined)}
    />,
  );

describe("askSourceHref", () => {
  it("opens each kind of source where it lives", () => {
    expect(askSourceHref(ANSWER.sources[0]!)).toBe("/documents?document=d1");
    expect(askSourceHref(ANSWER.sources[1]!)).toBe(
      "/chat?channel=c1&message=m1",
    );
    expect(
      askSourceHref({
        ...ANSWER.sources[0]!,
        target: { type: "meeting", meeting_id: "mt1" },
      }),
    ).toBe("/meetings/mt1");
    expect(
      askSourceHref({
        ...ANSWER.sources[0]!,
        target: { type: "page", page: "events" },
      }),
    ).toBe("/events");
  });

  it("has no link for a target this build has no page for", () => {
    expect(askSourceHref(ANSWER.sources[2]!)).toBeNull();
    expect(
      askSourceHref({
        ...ANSWER.sources[0]!,
        target: { type: "page", page: "dues" },
      }),
    ).toBeNull();
    expect(askSourceHref({ ...ANSWER.sources[0]!, target: null })).toBeNull();
  });
});

describe("AskExchangeView", () => {
  it("offers Report this under an answer, and nothing under one never attempted (#4315)", () => {
    const { unmount } = show(exchange({ askId: "a-1" }));
    expect(
      screen.getByRole("button", { name: AI_REPORT_COPY.action }),
    ).toBeInTheDocument();
    unmount();
    show(
      exchange({
        askId: "a-2",
        answer: { ...ANSWER, status: "unavailable", reason: "not_available" },
      }),
    );
    expect(
      screen.queryByRole("button", { name: AI_REPORT_COPY.action }),
    ).toBeNull();
  });

  it("marks each cited sentence with a link to its source", () => {
    show(exchange());
    expect(
      screen.getByRole("link", { name: "Source 1: Bylaws" }),
    ).toHaveAttribute("href", "/documents?document=d1");
    expect(
      screen.getByRole("link", { name: "Source 2: #general" }),
    ).toHaveAttribute("href", "/chat?channel=c1&message=m1");
  });

  it("shows a source of a kind it does not know as plain text, with no link", () => {
    show(exchange());
    expect(screen.queryByRole("link", { name: /Something newer/ })).toBeNull();
    expect(
      screen.getByLabelText("Source 3: Something newer"),
    ).toBeInTheDocument();
  });

  it("lists the sources with their kind, place and full date", () => {
    show(exchange());
    const list = screen.getByRole("list");
    expect(
      within(list).getByText("Document · Article IV · January 10, 2026"),
    ).toBeInTheDocument();
    expect(
      within(list).getByText("Channel message · November 9, 2026"),
    ).toBeInTheDocument();
    // Live or undated data says when it was read, never a blank.
    expect(within(list).getByText(ASK_COPY.live)).toBeInTheDocument();
  });

  it("says it could not find it, and shows no answer text", () => {
    show(
      exchange({
        answer: {
          ...ANSWER,
          status: "not_found",
          text: "",
          citations: [],
          sources: [],
        },
      }),
    );
    expect(screen.getByText(ASK_COPY.not_found)).toBeInTheDocument();
    expect(screen.queryByText(ASK_COPY.sources)).toBeNull();
  });

  it("warns when part of the answer could not be matched, was cut short, or left messages out", () => {
    show(
      exchange({
        answer: {
          ...ANSWER,
          unverified_citations: 1,
          truncated: true,
          left_out_messages: 2,
        },
      }),
    );
    expect(screen.getByText(ASK_COPY.unverified)).toBeInTheDocument();
    expect(screen.getByText(ASK_COPY.truncated)).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 messages from members who opted out aren't included.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the step under the streamed text while it works", () => {
    show(
      exchange({
        phase: "working",
        step: "reading",
        preview: "Quorum is",
        answer: null,
      }),
    );
    expect(screen.getByText("Quorum is")).toBeInTheDocument();
    expect(screen.getByText(ASK_COPY.steps.reading)).toBeInTheDocument();
  });

  it("falls back to a step it knows for one it does not", () => {
    show(exchange({ phase: "working", step: "pondering", answer: null }));
    expect(screen.getByText(ASK_COPY.steps.searching)).toBeInTheDocument();
  });

  it("offers the AI sheet when the member has not answered it", async () => {
    const consent = vi.fn();
    show(
      exchange({
        answer: {
          ...ANSWER,
          status: "unavailable",
          reason: "consent_required",
          text: "",
          citations: [],
          sources: [],
        },
      }),
      { consent },
    );
    expect(
      screen.getByText(ASK_COPY.unavailable.consent_required),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: ASK_COPY.consent_action }));
    expect(consent).toHaveBeenCalled();
  });

  it("offers Try again after a failure that may not repeat, and not after one that will", async () => {
    const retry = vi.fn();
    const { unmount } = show(
      exchange({
        phase: "failed",
        answer: null,
        failure: { message: ASK_COPY.failed, retryable: true },
      }),
      { retry },
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: ASK_COPY.try_again }));
    expect(retry).toHaveBeenCalled();
    unmount();
    show(
      exchange({
        phase: "failed",
        answer: null,
        failure: { message: ASK_COPY.failed, retryable: false },
      }),
    );
    expect(
      screen.queryByRole("button", { name: ASK_COPY.try_again }),
    ).toBeNull();
  });
});
