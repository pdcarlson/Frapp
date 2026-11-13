import { describe, expect, it, vi } from "vitest";
import {
  buildFormMessage,
  canCloseForm,
  fetchOwnFormResponse,
  formAnswerProblems,
  formAnswersForSave,
  formCardAction,
  formDeadlineLine,
  formQuestionCountLine,
  isFormClosed,
  readFormPayload,
  saveFormResponse,
  type FormPayload,
  formOpenRead,
  formOpenReadNote,
} from "./forms";
import type { FrappApiClient } from "./chat-client";
import type { ChatMessage } from "./types";

const NOW = Date.parse("2026-11-13T12:00:00Z");

const message = (payload: unknown, extra: Partial<ChatMessage> = {}) =>
  ({
    id: "m1",
    sender_id: "u1",
    kind: "form",
    payload,
    is_deleted: false,
    _status: "confirmed",
    ...extra,
  }) as unknown as ChatMessage;

const card: FormPayload = {
  title: "Room picks",
  questions: [
    { id: "name", type: "short_answer", title: "Name", required: true },
    {
      id: "nights",
      type: "checkboxes",
      title: "Nights",
      required: false,
      options: [
        { id: "fri", label: "Friday" },
        { id: "sat", label: "Saturday" },
      ],
    },
    { id: "why", type: "paragraph", title: "Why?", required: false },
  ],
};

describe("forms (#3926 step 3)", () => {
  it("builds the card a client posts, with ids for questions and options", () => {
    let n = 0;
    const built = buildFormMessage(
      {
        title: " Room picks ",
        description: " ",
        questions: [
          { type: "yes_no", title: "Staying?", required: true },
          {
            type: "dropdown",
            title: "Room",
            required: false,
            options: [" A "],
          },
        ],
        closesAt: new Date("2026-11-20T18:00:00Z"),
      },
      () => `id${++n}`,
    );
    expect(built).toEqual({
      content: "Room picks",
      payload: {
        title: "Room picks",
        questions: [
          { id: "id1", type: "yes_no", title: "Staying?", required: true },
          {
            id: "id2",
            type: "dropdown",
            title: "Room",
            required: false,
            options: [{ id: "id3", label: "A" }],
          },
        ],
        closes_at: "2026-11-20T18:00:00.000Z",
      },
    });
  });

  it("reads a card, skipping a question type it doesn't know", () => {
    const read = readFormPayload(
      message({
        ...card,
        questions: [...card.questions, { id: "x", type: "slider", title: "?" }],
        closed_at: "2026-11-13T00:00:00Z",
      }),
    );
    expect(read?.questions.map((q) => q.id)).toEqual(["name", "nights", "why"]);
    expect(read?.closed_at).toBe("2026-11-13T00:00:00Z");
    expect(readFormPayload(message({ title: "T", questions: [] }))).toBeNull();
    expect(readFormPayload(message(null))).toBeNull();
  });

  it("reads closed and the deadline line as the API does", () => {
    expect(
      isFormClosed({ ...card, closes_at: "2026-11-13T12:00:00Z" }, NOW),
    ).toBe(true);
    expect(formDeadlineLine({ ...card, closed_at: "x" }, NOW)).toBe("Closed");
    expect(formDeadlineLine(card, NOW)).toBeNull();
    expect(
      formDeadlineLine({ ...card, closes_at: "2026-11-14T12:00:00Z" }, NOW),
    ).toMatch(
      /^Closes (today|tomorrow|[A-Z][a-z]+day|[A-Z][a-z]{2} \d+) at \d/,
    );
    expect(formQuestionCountLine(card)).toBe("3 questions");
  });

  it("offers Close form to its creator or a moderator while it is open", () => {
    expect(canCloseForm(message(card), card, "u1", NOW, false)).toBe(true);
    expect(canCloseForm(message(card), card, "u2", NOW, false)).toBe(false);
    expect(canCloseForm(message(card), card, "u2", NOW, true)).toBe(true);
    expect(
      canCloseForm(
        message(card),
        { ...card, closed_at: "x" },
        "u1",
        NOW,
        false,
      ),
    ).toBe(false);
  });

  it("labels the card's button by answered and closed", () => {
    expect(formCardAction(false, false)).toEqual({
      label: "Fill out",
      done: false,
    });
    expect(formCardAction(true, false)).toEqual({
      label: "Edit your answers",
      done: true,
    });
    expect(formCardAction(true, true).label).toBe("View your answers");
    expect(formCardAction(undefined, false).label).toBe("Open");
  });

  it("names a blank required question and an answer too long", () => {
    expect(formAnswerProblems(card.questions, { nights: [] })).toEqual({
      name: "This question is required.",
    });
    expect(
      formAnswerProblems(card.questions, { name: "x".repeat(301) }),
    ).toEqual({ name: "Keep it to 300 characters." });
    expect(formAnswerProblems(card.questions, { name: "Sam" })).toEqual({});
  });

  it("sends trimmed answers, no blanks, checkboxes in the card's order", () => {
    expect(
      formAnswersForSave(card.questions, {
        name: " Sam ",
        nights: ["sat", "fri", "gone"],
        why: "  ",
        removed: "x",
      }),
    ).toEqual({ name: "Sam", nights: ["fri", "sat"] });
  });

  it("reads and saves the viewer's own answers through the API", async () => {
    const response = { answers: { name: "Sam" }, updated_at: "t" };
    const api = {
      GET: vi.fn(async () => ({ data: { response } })),
      PUT: vi.fn(async () => ({ data: response })),
    } as unknown as FrappApiClient;
    await expect(fetchOwnFormResponse(api, "m1")).resolves.toEqual(response);
    await expect(saveFormResponse(api, "m1", { name: "Sam" })).resolves.toEqual(
      response,
    );
    expect(api.PUT).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/form-response",
      {
        params: { path: { messageId: "m1" } },
        body: { answers: { name: "Sam" } },
      },
    );

    const refusing = {
      PUT: vi.fn(async () => ({ error: { message: "This form is closed" } })),
    } as unknown as FrappApiClient;
    await expect(saveFormResponse(refusing, "m1", {})).rejects.toThrow(
      "This form is closed",
    );
  });
});

describe("formOpenRead (#4752)", () => {
  const state = (
    fetchStatus: "fetching" | "paused" | "idle",
    failureCount: number,
    isFetchedAfterMount: boolean,
  ) => ({ fetchStatus, failureCount, isFetchedAfterMount });

  it("holds until a read since the page opened lands", () => {
    expect(formOpenRead(state("fetching", 0, false))).toBe("reading");
    expect(formOpenRead(state("idle", 0, true))).toBe("read");
    // A background refetch after the read landed doesn't hold it again.
    expect(formOpenRead(state("fetching", 0, true))).toBe("read");
  });

  it("doesn't wait on a read the network or a failure holds up", () => {
    expect(formOpenRead(state("paused", 0, false))).toBe("offline");
    expect(formOpenRead(state("paused", 1, false))).toBe("offline");
    expect(formOpenRead(state("fetching", 1, false))).toBe("unchecked");
    // A failed read is a data-or-error update, but not a read that landed.
    expect(formOpenRead(state("idle", 4, true))).toBe("unchecked");
  });

  it("says why only while the answers may be behind", () => {
    expect(formOpenReadNote("read", true)).toBeNull();
    expect(formOpenReadNote("reading", true)).toBeNull();
    expect(formOpenReadNote("unchecked", false)).toBeNull();
    expect(formOpenReadNote("offline", true)).toContain("You're offline");
    expect(formOpenReadNote("offline", false)).toContain("load when");
    expect(formOpenReadNote("unchecked", true)).toContain(
      "Couldn't check for newer answers",
    );
  });
});
