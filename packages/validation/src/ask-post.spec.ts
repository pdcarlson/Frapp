import { describe, expect, it } from "vitest";
import {
  ASK_POST_COPY,
  ASK_POST_REFUSALS,
  AskPostRequestSchema,
  askPostedSourceTitle,
  askPostRefusalCopy,
  askPostRestrictedList,
  isAskAnswerPostedBy,
  readAskPostedAnswer,
} from "./ask-post";
import { copyForErrorCode } from "./error-copy";

const CHANNEL = "c0ffee00-0000-4000-8000-4000000000b2";

describe("AskPostRequestSchema", () => {
  it("takes a channel, the receipt and whether to post", () => {
    expect(
      AskPostRequestSchema.safeParse({
        channel_id: CHANNEL,
        receipt: "sealed",
        confirm: false,
      }).success,
    ).toBe(true);
  });

  it("has no field for the answer's words: what is posted is what the server sealed", () => {
    expect(Object.keys(AskPostRequestSchema.shape).sort()).toEqual([
      "acknowledged",
      "channel_id",
      "confirm",
      "receipt",
    ]);
  });

  it("refuses an empty receipt and a channel that is not an id", () => {
    expect(
      AskPostRequestSchema.safeParse({
        channel_id: CHANNEL,
        receipt: "",
        confirm: true,
      }).success,
    ).toBe(false);
    expect(
      AskPostRequestSchema.safeParse({
        channel_id: "general",
        receipt: "sealed",
        confirm: true,
      }).success,
    ).toBe(false);
  });
});

describe("readAskPostedAnswer", () => {
  const payload = {
    v: 1,
    ask_id: "ask-1",
    asked_by: "user-1",
    question: "When is formal?",
    citations: [{ source: 0, at: 4 }],
    sources: [
      {
        kind: "events",
        title: "Events",
        detail: null,
        date: null,
        target: { type: "page", page: "events" },
      },
    ],
  };

  it("reads a posted answer, keeping a target's own fields", () => {
    const read = readAskPostedAnswer(payload);
    expect(read?.asked_by).toBe("user-1");
    expect(read?.sources[0]?.target).toEqual({ type: "page", page: "events" });
  });

  it("is null for anything else, so the row falls back to its words", () => {
    expect(readAskPostedAnswer(null)).toBeNull();
    expect(readAskPostedAnswer({ v: 1 })).toBeNull();
    expect(readAskPostedAnswer({ ...payload, sources: "none" })).toBeNull();
  });
});

describe("askPostedSourceTitle", () => {
  it("leaves a chapter source's name as it is", () => {
    expect(
      askPostedSourceTitle({ kind: "meeting", title: "Exec minutes" }, "Sam"),
    ).toBe("Exec minutes");
  });

  it("names the asker's own records as theirs, never as the reader's", () => {
    const own = { kind: "tasks", title: "Your tasks", own: true };
    expect(askPostedSourceTitle(own, "Sam Abernathy")).toBe(
      "Sam Abernathy's tasks",
    );
    expect(askPostedSourceTitle(own, null)).toBe("The asker's tasks");
    expect(askPostedSourceTitle({ ...own, kind: "something_new" }, null)).toBe(
      "The asker's records",
    );
  });
});

describe("askPostRestrictedList", () => {
  const items = (...titles: string[]) => titles.map((title) => ({ title }));

  it("reads as a sentence's list", () => {
    expect(askPostRestrictedList(items())).toBe("");
    expect(askPostRestrictedList(items("A"))).toBe("A");
    expect(askPostRestrictedList(items("A", "B"))).toBe("A and B");
    expect(askPostRestrictedList(items("A", "B", "C"))).toBe("A, B and C");
  });

  it("counts what it does not name", () => {
    expect(askPostRestrictedList(items("A", "B", "C", "D", "E"))).toBe(
      "A, B, C and 2 more",
    );
  });
});

describe("refusals and copy", () => {
  it("gives each refusal the server names its sentence, and null for one it doesn't know", () => {
    for (const [code, sentence] of Object.entries(ASK_POST_REFUSALS)) {
      expect(askPostRefusalCopy(code)).toBe(sentence);
      expect(copyForErrorCode(code)).toBe(sentence);
    }
    expect(askPostRefusalCopy("ai.ask.post.something_new")).toBeNull();
    expect(askPostRefusalCopy(null)).toBeNull();
  });

  it("names who asked, or a member when the roster can't", () => {
    expect(ASK_POST_COPY.asked("Sam Abernathy")).toBe(
      "Sam Abernathy asked Frapp",
    );
    expect(ASK_POST_COPY.asked(null)).toBe("A member asked Frapp");
  });
});

describe("isAskAnswerPostedBy", () => {
  const posted = { kind: "ask_answer", payload: { asked_by: "user-1" } };

  it("is true for the member the server wrote as the asker, and nobody else", () => {
    expect(isAskAnswerPostedBy(posted, "user-1")).toBe(true);
    expect(isAskAnswerPostedBy(posted, "user-2")).toBe(false);
    expect(isAskAnswerPostedBy(posted, null)).toBe(false);
  });

  it("reads the asker from this kind alone, and from a payload it can read", () => {
    expect(isAskAnswerPostedBy({ ...posted, kind: "poll" }, "user-1")).toBe(
      false,
    );
    expect(
      isAskAnswerPostedBy({ kind: "ask_answer", payload: null }, "user-1"),
    ).toBe(false);
    expect(
      isAskAnswerPostedBy({ kind: "ask_answer", payload: "user-1" }, "user-1"),
    ).toBe(false);
  });
});
