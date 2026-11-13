import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AskExchange } from "@repo/hooks";
import {
  ACT_COPY,
  AI_REPORT_COPY,
  ASK_COPY,
  askReadLine,
  type AskAnswer,
} from "@repo/validation";

const channelList = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // The reader has #rush-week and not #exec.
  useChannels: () => {
    channelList.reads += 1;
    return { data: [{ id: "c1", name: "rush-week" }] };
  },
  useMyPermissions: () => ({ data: { permissions: ["ai:use"] } }),
  useActEventAudience: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { AskTurn } = await import("./ask-answer");
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
  id: "turn-1",
  question: "What is quorum?",
  phase: "done",
  step: null,
  preview: "",
  answer: ANSWER,
  proposal: null,
  resolution: null,
  failure: null,
  ...overrides,
});

const show = (
  value: AskExchange,
  handlers: {
    retry?: () => void;
    consent?: () => void;
    followMessage?: () => void;
  } = {},
) =>
  render(
    <AskTurn
      exchange={value}
      onRetry={handlers.retry ?? (() => undefined)}
      onAnswerConsent={handlers.consent ?? (() => undefined)}
      onFollowMessage={handlers.followMessage}
      onProposal={() => undefined}
      onResolved={() => undefined}
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

describe("AskTurn", () => {
  // The icon is named for what it reports; its tooltip is the plain action.
  const REPORT = AI_REPORT_COPY.titles.ask_answer;

  it("offers Report under an answer as a quiet icon, and nothing under one never attempted (#4315)", () => {
    const { unmount } = show(exchange({ askId: "a-1" }));
    const report = screen.getByRole("button", { name: REPORT });
    expect(report).toHaveAttribute("title", AI_REPORT_COPY.action);
    // Paul, 2026-11-13: Report is not the answer's one loud control. It is
    // an icon in the muted tone, and its words are not on screen.
    expect(report).toHaveClass("text-muted-foreground/70");
    expect(screen.queryByText(AI_REPORT_COPY.action)).toBeNull();
    unmount();
    show(
      exchange({
        askId: "a-2",
        answer: { ...ANSWER, status: "unavailable", reason: "not_available" },
      }),
    );
    expect(screen.queryByRole("button", { name: REPORT })).toBeNull();
  });

  it("copies the answer's words, and says so for a moment", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    show(exchange({ askId: "a-1" }));
    await userEvent.click(
      screen.getByRole("button", { name: ASK_COPY.copy_answer }),
    );
    expect(writeText).toHaveBeenCalledWith(ANSWER.text);
    expect(
      await screen.findByRole("button", { name: ASK_COPY.copied_answer }),
    ).toBeInTheDocument();
  });

  it("has nothing to copy under an answer with no words", () => {
    show(
      exchange({
        askId: "a-1",
        answer: {
          ...ANSWER,
          status: "not_found",
          text: "",
          citations: [],
          sources: [],
        },
      }),
    );
    expect(
      screen.queryByRole("button", { name: ASK_COPY.copy_answer }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: REPORT })).toBeInTheDocument();
  });

  it("says what Frapp read under a finished answer, before its sources", () => {
    show(exchange({ askId: "a-1", read: { reads: ["events"], found: 3 } }));
    const line = screen.getByText(
      askReadLine({ reads: ["events"], found: 3 })!,
    );
    const sources = screen.getByRole("list", { name: ASK_COPY.sources });
    expect(
      line.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sources.compareDocumentPosition(
        screen.getByRole("button", { name: REPORT }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws no read line when the server named nothing it read", () => {
    show(exchange({ askId: "a-1" }));
    expect(screen.queryByText(/^Read /)).toBeNull();
  });

  it("paints the member's own words in the chapter's colour", () => {
    show(exchange());
    expect(
      screen.getByRole("heading", { name: "What is quorum?" }),
    ).toHaveClass("bg-primary", "text-primary-foreground");
  });

  it("tells the card when a cited chat message is followed, and not for a source that opens beside chat", async () => {
    const followMessage = vi.fn();
    show(exchange(), { followMessage });
    const list = screen.getByRole("list", { name: ASK_COPY.sources });
    // jsdom has no navigation; keep the click from logging one.
    list.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(
      within(list).getByRole("link", { name: /^Source 1: Bylaws/ }),
    );
    expect(followMessage).not.toHaveBeenCalled();
    await userEvent.click(
      within(list).getByRole("link", { name: /^Source 2: #general/ }),
    );
    expect(followMessage).toHaveBeenCalledTimes(1);
    // Opening it in a new tab leaves this one, and the card, as they are.
    fireEvent.click(
      within(list).getByRole("link", { name: /^Source 2: #general/ }),
      { ctrlKey: true },
    );
    expect(followMessage).toHaveBeenCalledTimes(1);
  });

  it("draws a listed person as a mention and a channel the reader has as a link (#4904)", async () => {
    const followMessage = vi.fn();
    show(
      exchange({
        answer: {
          ...ANSWER,
          text: "Ask @Sam Abernathy in #rush-week or #exec, not @Nobody.",
          citations: [],
          entities: [
            { type: "member", id: "u1", name: "Sam Abernathy" },
            { type: "channel", id: "c1", name: "rush-week" },
            { type: "channel", id: "c9", name: "exec" },
          ],
        } as AskAnswer,
      }),
      { followMessage },
    );

    expect(screen.getByText("@Sam Abernathy").tagName).toBe("MARK");
    const channel = screen.getByRole("link", { name: "#rush-week" });
    expect(channel.getAttribute("href")).toContain("c1");
    channel.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(channel);
    expect(followMessage).toHaveBeenCalledTimes(1);

    // A channel the reader cannot open, and a name the server did not list,
    // are the plain words.
    expect(screen.queryByRole("link", { name: "#exec" })).toBeNull();
    expect(screen.queryByText("@Nobody")).toBeNull();
    expect(
      screen.getByText(/or #exec, not @Nobody\./),
    ).toBeTruthy();
  });

  it("reads the channel list only for an answer that names a channel", () => {
    channelList.reads = 0;
    show(exchange());
    expect(channelList.reads).toBe(0);
    expect(screen.queryByRole("mark")).toBeNull();
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

  it("lists the sources as chips, each named with its kind, place and full date", () => {
    show(exchange());
    const list = screen.getByRole("list", { name: ASK_COPY.sources });
    expect(
      within(list).getByRole("link", {
        name: "Source 1: Bylaws, Document · Article IV · January 10, 2026",
      }),
    ).toHaveAttribute("href", "/documents?document=d1");
    expect(
      within(list).getByRole("link", {
        name: "Source 2: #general, Channel message · November 9, 2026",
      }),
    ).toBeInTheDocument();
    // Live or undated data says when it was read, never a blank; a source
    // this build has no page for is a chip with no link.
    expect(
      within(list).getByLabelText(
        `Source 3: Something newer, ${ASK_COPY.live}`,
      ),
    ).toBeInTheDocument();
  });

  it("shows the card in place of an answer when the member asked for something to be done", () => {
    show(
      exchange({
        answer: null,
        proposal: {
          status: "unclear",
          action: "give_points",
          suggestion: null,
          notes: [],
          event_choice: null,
          missing: "amount",
          reason: null,
          available_actions: [],
        },
      }),
    );
    expect(screen.getByText(ACT_COPY.missing.amount)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: AI_REPORT_COPY.titles.ask_answer }),
    ).toBeNull();
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
    expect(screen.queryByRole("list", { name: ASK_COPY.sources })).toBeNull();
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

  it("says what is being read, and that a card is being worked out", () => {
    show(
      exchange({
        phase: "working",
        step: "reading",
        stepDetail: { reads: ["events", "my_tasks"], found: 3 },
        answer: null,
      }),
    );
    expect(
      screen.getByText("Reading the events calendar, your tasks and 3 sources"),
    ).toBeInTheDocument();
    cleanup();
    show(exchange({ phase: "working", step: "proposing", answer: null }));
    expect(screen.getByText(ASK_COPY.steps.proposing)).toBeInTheDocument();
  });

  it("says nothing under a turn that has not been sent yet", () => {
    // The AI question is still open: no search has started.
    show(exchange({ phase: "working", step: null, answer: null }));
    expect(screen.queryByText(ASK_COPY.steps.searching)).toBeNull();
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

  it("holds both ways of asking a turn again while another turn is being answered", () => {
    const view = render(
      <AskTurn
        busy
        exchange={exchange({
          phase: "failed",
          answer: null,
          failure: { message: ASK_COPY.failed, retryable: true },
        })}
        onRetry={() => undefined}
        onAnswerConsent={() => undefined}
        onProposal={() => undefined}
        onResolved={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: ASK_COPY.try_again }),
    ).toBeDisabled();
    view.rerender(
      <AskTurn
        busy
        exchange={exchange({
          answer: {
            ...ANSWER,
            status: "unavailable",
            reason: "consent_required",
            text: "",
            citations: [],
            sources: [],
          },
        })}
        onRetry={() => undefined}
        onAnswerConsent={() => undefined}
        onProposal={() => undefined}
        onResolved={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: ASK_COPY.consent_action }),
    ).toBeDisabled();
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
