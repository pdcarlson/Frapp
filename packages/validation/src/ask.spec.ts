import { describe, expect, it } from "vitest";

import {
  ASK_COPY,
  ASK_STEPS,
  ASK_STREAM_KEEPALIVE,
  ASK_STREAM_VERSION,
  ASK_HISTORY_ANSWER_MAX_LENGTH,
  ASK_HISTORY_MAX_TURNS,
  ASK_QUESTION_MAX_LENGTH,
  ASK_SUGGESTION_NAME_MAX,
  AskRequestSchema,
  AskSuggestionSchema,
  askAnswerSegments,
  askHistory,
  askLeftOutLine,
  askReadLine,
  askSourceKindLabel,
  askSourceTarget,
  askStepLine,
  askSuggestionName,
  askSuggestionText,
  askUnavailableLine,
  createAskStreamReader,
  encodeAskStreamEvent,
  parseAskStreamEvent,
  readChannelAsk,
  replyAskRefusal,
  type AskAnswer,
  type AskStreamEvent,
} from "./ask";

const v = ASK_STREAM_VERSION;

const answer: AskAnswer = {
  status: "answered",
  reason: null,
  text: "Quorum is two-thirds of active members.",
  citations: [{ source: 0, at: 39, quote: "two-thirds of active members" }],
  sources: [
    {
      id: "p1",
      kind: "document",
      title: "Bylaws",
      detail: "Article IV",
      date: "2026-01-10T00:00:00.000Z",
      target: { type: "document", document_id: "d1", page: 3 },
    },
  ],
  left_out_messages: 0,
  unverified_citations: 0,
  truncated: false,
  saved: false,
};

describe("the Ask stream format", () => {
  it("round-trips every event through its frame", () => {
    const events: AskStreamEvent[] = [
      { v, type: "start", ask_id: "a1" },
      { v, type: "status", step: "searching" },
      { v, type: "text", delta: "Quorum is\ntwo-thirds" },
      { v, type: "done", answer },
      { v, type: "error", code: "ask.failed", retryable: true },
    ];
    const reader = createAskStreamReader();
    const wire = events.map(encodeAskStreamEvent).join("");
    expect(reader.feed(wire)).toEqual(events);
  });

  it("holds a frame split across chunks until it is whole", () => {
    const reader = createAskStreamReader();
    const frame = encodeAskStreamEvent({ v, type: "text", delta: "hello" });
    const cut = Math.floor(frame.length / 2);
    expect(reader.feed(frame.slice(0, cut))).toEqual([]);
    expect(reader.feed(frame.slice(cut))).toEqual([
      { v, type: "text", delta: "hello" },
    ]);
  });

  it("skips keepalives, CRLF framing and frames it does not know", () => {
    const reader = createAskStreamReader();
    const wire =
      ASK_STREAM_KEEPALIVE +
      `data: ${JSON.stringify({ v, type: "from_the_future", x: 1 })}\n\n` +
      `data: ${JSON.stringify({ v: 2, type: "text", delta: "v2" })}\n\n` +
      "data: not json\n\n" +
      `data: ${JSON.stringify({ v, type: "text", delta: "ok" })}\r\n\r\n`;
    expect(reader.feed(wire)).toEqual([{ v, type: "text", delta: "ok" }]);
  });

  it("keeps an event whose keys it does not all know", () => {
    expect(
      parseAskStreamEvent(
        JSON.stringify({ v, type: "status", step: "thinking", extra: true }),
      ),
    ).toEqual({ v, type: "status", step: "thinking" });
  });

  it("carries what a reading step says is being read", () => {
    const event = {
      v,
      type: "status",
      step: "reading",
      reads: ["roster"],
      found: 3,
    };
    expect(parseAskStreamEvent(JSON.stringify(event))).toEqual(event);
  });

  it("keeps a source of a kind and target it does not know, without a link", () => {
    const event = parseAskStreamEvent(
      JSON.stringify({
        v,
        type: "done",
        answer: {
          ...answer,
          sources: [
            {
              id: "s",
              kind: "recording",
              title: "Chapter meeting recording",
              detail: null,
              date: null,
              target: { type: "recording", recording_id: "r1" },
            },
          ],
        },
      }),
    );
    expect(event?.type).toBe("done");
    if (event?.type !== "done") return;
    expect(askSourceTarget(event.answer.sources[0])).toBeNull();
  });
});

describe("askHistory", () => {
  const turn = (question: string, given: AskAnswer | null = answer) => ({
    question,
    answer: given,
  });

  it("sends a finished turn as its question and its answer", () => {
    expect(askHistory([turn(" What is quorum? ")])).toEqual([
      { question: "What is quorum?", answer: answer.text },
    ]);
  });

  it("says how many cards a turn's answer came with, for a turn that was cards alone too", () => {
    expect(
      askHistory([
        turn("Who is behind on hours?", { ...answer, proposals: ["s1"] }),
        turn("Make tasks for them", {
          ...answer,
          text: "",
          proposals: ["s2", "s3"],
        }),
        turn("And quorum?", { ...answer, proposals: [] }),
      ]),
    ).toEqual([
      { question: "Who is behind on hours?", answer: answer.text, cards: 1 },
      { question: "Make tasks for them", answer: "", cards: 2 },
      { question: "And quorum?", answer: answer.text },
    ]);
  });

  it("marks a turn whose question was a tapped suggestion, and only that turn", () => {
    expect(
      askHistory([
        { ...turn("When and where is Formal on Friday?"), suggested: true },
        turn("And the one after?"),
        { ...turn("What is quorum?"), suggested: false },
      ]),
    ).toEqual([
      {
        question: "When and where is Formal on Friday?",
        answer: answer.text,
        suggested: true,
      },
      { question: "And the one after?", answer: answer.text },
      { question: "What is quorum?", answer: answer.text },
    ]);
  });

  it("sends only the question of a turn with no answer to carry", () => {
    const miss: AskAnswer = { ...answer, status: "not_found", text: "" };
    const refused: AskAnswer = { ...answer, status: "refused", text: "" };
    expect(
      askHistory([turn("a", miss), turn("b", refused), turn("c", null)]),
    ).toEqual([
      { question: "a", answer: "" },
      { question: "b", answer: "" },
      { question: "c", answer: "" },
    ]);
  });

  it("never sends back an answer that cites chat", () => {
    const cited: AskAnswer = {
      ...answer,
      sources: [{ ...answer.sources[0]!, kind: "chat" }],
    };
    expect(askHistory([turn("Who is driving?", cited)])).toEqual([
      { question: "Who is driving?", answer: "" },
    ]);
  });

  it("never sends back an answer the model wrote with chat in front of it, cited or not", () => {
    expect(
      askHistory([turn("Who is driving?", { ...answer, read_chat: true })]),
    ).toEqual([{ question: "Who is driving?", answer: "" }]);
    // A server that says the model read none, or says nothing, is carried.
    expect(
      askHistory([
        turn("a", { ...answer, read_chat: false }),
        turn("b", { ...answer, read_chat: null }),
      ]).map((sent) => sent.answer),
    ).toEqual([answer.text, answer.text]);
  });

  it("keeps the last few turns, the newest last, within what the server accepts", () => {
    const many = Array.from({ length: ASK_HISTORY_MAX_TURNS + 3 }, (_, index) =>
      turn(`question ${index}`),
    );
    const sent = askHistory(many);
    expect(sent).toHaveLength(ASK_HISTORY_MAX_TURNS);
    expect(sent[0]!.question).toBe("question 3");
    expect(sent.at(-1)!.question).toBe(`question ${ASK_HISTORY_MAX_TURNS + 2}`);
  });

  it("cuts a long question and a long answer to the server's limits", () => {
    const [sent] = askHistory([
      turn("q".repeat(ASK_QUESTION_MAX_LENGTH + 50), {
        ...answer,
        text: "a".repeat(ASK_HISTORY_ANSWER_MAX_LENGTH + 50),
      }),
    ]);
    expect(sent!.question).toHaveLength(ASK_QUESTION_MAX_LENGTH);
    expect(sent!.answer).toHaveLength(ASK_HISTORY_ANSWER_MAX_LENGTH);
  });

  it("never cuts a two-unit character in half", () => {
    const text = `${"a".repeat(ASK_HISTORY_ANSWER_MAX_LENGTH - 1)}\u{1F600}tail`;
    const [sent] = askHistory([turn("q", { ...answer, text })]);
    expect(sent!.answer).toBe("a".repeat(ASK_HISTORY_ANSWER_MAX_LENGTH - 1));
  });
});

describe("askSourceTarget", () => {
  it("reads each known target", () => {
    expect(askSourceTarget(answer.sources[0])).toEqual({
      type: "document",
      document_id: "d1",
      page: 3,
    });
    const base = { ...answer.sources[0] };
    expect(
      askSourceTarget({
        ...base,
        target: { type: "meeting", meeting_id: "m" },
      }),
    ).toEqual({ type: "meeting", meeting_id: "m" });
    expect(
      askSourceTarget({
        ...base,
        target: { type: "message", channel_id: "c", message_id: "m" },
      }),
    ).toEqual({ type: "message", channel_id: "c", message_id: "m" });
    expect(
      askSourceTarget({ ...base, target: { type: "page", page: "events" } }),
    ).toEqual({ type: "page", page: "events" });
  });

  it("refuses a target missing its ids or naming a page this build lacks", () => {
    const base = { ...answer.sources[0] };
    expect(askSourceTarget({ ...base, target: null })).toBeNull();
    expect(
      askSourceTarget({ ...base, target: { type: "meeting" } }),
    ).toBeNull();
    expect(
      askSourceTarget({ ...base, target: { type: "page", page: "vault" } }),
    ).toBeNull();
  });
});

describe("the Ask request", () => {
  it("trims the question and refuses an empty or oversized one", () => {
    expect(AskRequestSchema.parse({ question: "  When?  " }).question).toBe(
      "When?",
    );
    expect(AskRequestSchema.safeParse({ question: "   " }).success).toBe(false);
    expect(
      AskRequestSchema.safeParse({ question: "x".repeat(1001) }).success,
    ).toBe(false);
  });
});

describe("Ask copy", () => {
  it("counts left-out messages without saying whose", () => {
    expect(askLeftOutLine(1)).toBe(
      "1 message from a member who opted out isn't included.",
    );
    expect(askLeftOutLine(4)).toBe(
      "4 messages from members who opted out aren't included.",
    );
  });

  it("has a line for a reason it does not know", () => {
    expect(askUnavailableLine("something_new")).toBe(
      askUnavailableLine("not_available"),
    );
    expect(askUnavailableLine(null)).toBe(askUnavailableLine("not_available"));
  });
});

describe("askReadLine", () => {
  it("says in the past tense what a finished answer was read from, in the step line's words", () => {
    expect(askReadLine({ reads: ["events"], found: 0 })).toBe(
      "Read the events calendar",
    );
    expect(askReadLine({ reads: ["roster"], found: 3 })).toBe(
      "Read the roster and 3 sources",
    );
    expect(askReadLine({ reads: [], found: 1 })).toBe("Read 1 source");
  });

  it("is no line at all when the server named nothing this build has words for", () => {
    expect(askReadLine(null)).toBeNull();
    expect(askReadLine(undefined)).toBeNull();
    expect(askReadLine({})).toBeNull();
    expect(askReadLine({ reads: ["constructor"], found: 0 })).toBeNull();
  });
});

describe("askStepLine", () => {
  it("says what the server named, and searching for a step this build does not know", () => {
    expect(askStepLine("searching")).toBe("Searching your chapter's sources");
    expect(askStepLine("writing")).toBe("Writing");
    expect(askStepLine("proposing")).toBe("Working out what that would change");
    expect(askStepLine("pondering")).toBe("Searching your chapter's sources");
    expect(askStepLine(null)).toBe("Searching your chapter's sources");
    // An open string from the wire is never read off the object itself.
    expect(askStepLine("constructor")).toBe("Searching your chapter's sources");
  });

  it("names the records being read and how many sources were found", () => {
    expect(askStepLine("reading", { reads: ["events"], found: 0 })).toBe(
      "Reading the events calendar",
    );
    expect(askStepLine("reading", { reads: [], found: 1 })).toBe(
      "Reading 1 source",
    );
    expect(askStepLine("reading", { reads: ["roster"], found: 3 })).toBe(
      "Reading the roster and 3 sources",
    );
    expect(
      askStepLine("reading", {
        reads: ["events", "my_tasks", "my_points"],
        found: 2,
      }),
    ).toBe(
      "Reading the events calendar, your tasks, your points and 2 sources",
    );
  });

  it("leaves out a read this build has no words for, and never reads a name off the object itself", () => {
    expect(
      askStepLine("reading", { reads: ["attendance", "roster"], found: 0 }),
    ).toBe("Reading the roster");
    expect(askStepLine("reading", { reads: ["constructor"], found: 2 })).toBe(
      "Reading 2 sources",
    );
  });

  it("says the plain reading line when an older server names nothing", () => {
    expect(askStepLine("reading")).toBe("Reading what it found");
    expect(askStepLine("reading", { reads: ["attendance"] })).toBe(
      "Reading what it found",
    );
  });

  it("has words for every step, and the line under a turn draws them", () => {
    for (const step of ASK_STEPS) {
      expect(ASK_COPY.steps[step].length).toBeGreaterThan(0);
      // A step added to the list is drawn without a change to `askStepLine`.
      expect(askStepLine(step)).toBe(ASK_COPY.steps[step]);
    }
  });
});

describe("askAnswerSegments", () => {
  it("puts each marker where the server placed it", () => {
    expect(askAnswerSegments(answer)).toEqual([
      { type: "text", text: "Quorum is two-thirds of active members." },
      { type: "citation", citation: answer.citations[0], index: 0 },
    ]);
  });

  it("cuts the text at a citation in the middle and keeps what follows", () => {
    const segments = askAnswerSegments({
      text: "One. Two.",
      citations: [{ source: 1, at: 4, quote: "one" }],
    });
    expect(segments.map((s) => (s.type === "text" ? s.text : "#"))).toEqual([
      "One.",
      "#",
      " Two.",
    ]);
  });

  it("draws one marker for a source cited twice at the same place, and both of two sources", () => {
    const segments = askAnswerSegments({
      text: "One.",
      citations: [
        { source: 0, at: 4, quote: "a" },
        { source: 0, at: 4, quote: "b" },
        { source: 2, at: 4, quote: "c" },
      ],
    });
    expect(
      segments.flatMap((s) =>
        s.type === "citation" ? [s.citation.source] : [],
      ),
    ).toEqual([0, 2]);
  });

  it("lands a citation past the end of the text at the end, in order", () => {
    const segments = askAnswerSegments({
      text: "One.",
      citations: [
        { source: 1, at: 99, quote: "late" },
        { source: 0, at: 0, quote: "early" },
      ],
    });
    expect(segments.map((s) => (s.type === "text" ? s.text : s.index))).toEqual(
      [1, "One.", 0],
    );
  });

  it("is the whole text when nothing is cited", () => {
    expect(askAnswerSegments({ text: "Plain.", citations: [] })).toEqual([
      { type: "text", text: "Plain." },
    ]);
  });
});

describe("askSourceKindLabel", () => {
  it("names the kinds this build knows and nothing for one it does not", () => {
    expect(askSourceKindLabel("chat")).toBe("Channel message");
    expect(askSourceKindLabel("minutes")).toBe("Minutes");
    expect(askSourceKindLabel("hologram")).toBeNull();
  });
});

describe("the opening suggestions", () => {
  it("writes each one as the member would type it, with nothing abbreviated", () => {
    expect(askSuggestionText.event("Chapter Meeting", "on Sunday")).toBe(
      "When and where is Chapter Meeting on Sunday?",
    );
    expect(askSuggestionText.task("Book the bus")).toBe(
      'When is my task "Book the bus" due?',
    );
    expect(askSuggestionText.tasks(3)).toBe(
      "Which of my 3 open tasks is due first?",
    );
    expect(askSuggestionText.dues("Fall dues")).toBe(
      "How much do I owe for Fall dues?",
    );
    expect(askSuggestionText.minutes("Chapter Meeting", "November 9")).toBe(
      "What was decided at Chapter Meeting on November 9?",
    );
    expect(askSuggestionText.points()).toBe(
      "How many points do I have this semester?",
    );
    expect(askSuggestionText.request("Sunday", "Saturday")).toBe(
      "Make a task for me to get ready for Sunday's event, due Saturday",
    );
  });

  it("puts a record's name on one line, and leaves out one that is empty or too long to name", () => {
    expect(askSuggestionName("  Chapter\n Meeting  ")).toBe("Chapter Meeting");
    expect(askSuggestionName("")).toBeNull();
    expect(askSuggestionName("   ")).toBeNull();
    expect(askSuggestionName(null)).toBeNull();
    expect(askSuggestionName("x".repeat(ASK_SUGGESTION_NAME_MAX))).toHaveLength(
      ASK_SUGGESTION_NAME_MAX,
    );
    expect(
      askSuggestionName("x".repeat(ASK_SUGGESTION_NAME_MAX + 1)),
    ).toBeNull();
  });

  it("reads a kind a newer server adds", () => {
    expect(
      AskSuggestionSchema.parse({
        kind: "something_new",
        text: "A question",
        request: false,
      }).kind,
    ).toBe("something_new");
  });
});

describe("what Send does with a channel message that names @Frapp (#4713)", () => {
  const read = (
    text: string,
    over: Partial<Parameters<typeof readChannelAsk>[0]> = {},
  ) =>
    readChannelAsk({
      text,
      names: [],
      access: "yes",
      attachments: 0,
      busy: false,
      ...over,
    });

  it("asks, with the handle taken out", () => {
    expect(read("@Frapp when is formal?")).toEqual({
      kind: "ask",
      question: "when is formal?",
    });
  });

  it("posts a message that does not name the handle, whatever else is so", () => {
    for (const access of ["yes", "no", "unknown"] as const) {
      expect(
        read("see you there", { access, attachments: 2, busy: true }),
      ).toEqual({ kind: "post" });
    }
  });

  it("posts it as ordinary text for a member without Ask", () => {
    expect(read("@Frapp when is formal?", { access: "no" })).toEqual({
      kind: "post",
    });
  });

  it("holds it while it is not yet known whether the member has Ask, before any other refusal", () => {
    // Posting is the one mistake that can't be taken back.
    for (const text of ["@Frapp when is formal?", "@Frapp"]) {
      expect(
        read(text, { access: "unknown", attachments: 1, busy: true }),
      ).toEqual({ kind: "refused", reason: ASK_COPY.ask_unknown });
    }
  });

  it("refuses in one order: attachments, no question, too long, still answering", () => {
    const long = `@Frapp ${"a".repeat(ASK_QUESTION_MAX_LENGTH + 1)}`;
    expect(read("@Frapp", { attachments: 1, busy: true })).toEqual({
      kind: "refused",
      reason: ASK_COPY.no_attachments,
    });
    expect(read("@Frapp", { busy: true })).toEqual({
      kind: "refused",
      reason: ASK_COPY.no_question,
    });
    expect(read(long, { busy: true })).toEqual({
      kind: "refused",
      reason: ASK_COPY.too_long,
    });
    expect(read("@Frapp and then?", { busy: true })).toEqual({
      kind: "refused",
      reason: ASK_COPY.still_answering,
    });
    expect(read(`@Frapp ${"a".repeat(ASK_QUESTION_MAX_LENGTH)}`).kind).toBe(
      "ask",
    );
  });

  it("reads the chapter's spaced names, and lets none of them capture the handle", () => {
    const names = ["Jordan Frapp", "Frapp What"];
    expect(read("@Jordan Frapp are you in?", { names })).toEqual({
      kind: "post",
    });
    expect(read("@Frapp what do I owe", { names })).toEqual({
      kind: "ask",
      question: "what do I owe",
    });
  });
});

describe("a thread reply that names @Frapp (#4713)", () => {
  it("is refused for a member with Ask, held while that is unknown, and sent without it", () => {
    expect(replyAskRefusal("@Frapp who is driving", [], "yes")).toBe(
      ASK_COPY.not_in_reply,
    );
    expect(replyAskRefusal("@Frapp who is driving", [], "unknown")).toBe(
      ASK_COPY.ask_unknown,
    );
    expect(replyAskRefusal("@Frapp who is driving", [], "no")).toBeNull();
  });

  it("sends a reply that does not name it", () => {
    for (const access of ["yes", "no", "unknown"] as const) {
      expect(replyAskRefusal("see you there", [], access)).toBeNull();
    }
    expect(
      replyAskRefusal("@Jordan Frapp you in?", ["Jordan Frapp"], "yes"),
    ).toBeNull();
  });
});
