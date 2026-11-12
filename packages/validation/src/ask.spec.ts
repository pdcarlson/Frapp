import { describe, expect, it } from "vitest";

import {
  ASK_STREAM_KEEPALIVE,
  ASK_STREAM_VERSION,
  AskRequestSchema,
  askAnswerSegments,
  askLeftOutLine,
  askSourceKindLabel,
  askSourceTarget,
  askUnavailableLine,
  createAskStreamReader,
  encodeAskStreamEvent,
  parseAskStreamEvent,
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

describe("askSourceTarget", () => {
  it("reads each known target", () => {
    expect(askSourceTarget(answer.sources[0])).toEqual({
      type: "document",
      document_id: "d1",
      page: 3,
    });
    const base = { ...answer.sources[0] };
    expect(
      askSourceTarget({ ...base, target: { type: "meeting", meeting_id: "m" } }),
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
    expect(askSourceTarget({ ...base, target: { type: "meeting" } })).toBeNull();
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
      segments.flatMap((s) => (s.type === "citation" ? [s.citation.source] : [])),
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
    expect(segments.map((s) => (s.type === "text" ? s.text : s.index))).toEqual([
      1,
      "One.",
      0,
    ]);
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
