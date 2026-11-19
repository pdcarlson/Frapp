import { describe, expect, it } from "vitest";
import { meetingDraftQuote } from "./meeting-draft";
import {
  EMPTY_MEETING_CONTENT,
  MEETING_TABLED_MAX_TIMES,
  MEETING_VOTE_MAX,
} from "./meetings";
import {
  BLANK_MINUTES_ROW,
  minutesDatesMissingDay,
  minutesTablingOffers,
  tabledRowFromAgenda,
  clampMeetingVote,
  cleanMeetingContent,
  minutesEditDraftOf,
  minutesStoredForm,
  sameMinutesDraft,
  type MinutesEditDraft,
} from "./minutes-edit";

const draft = (
  patch: Partial<MinutesEditDraft["content"]>,
  type: Partial<Omit<MinutesEditDraft, "content">> = {},
): MinutesEditDraft => ({
  meeting_type: "chapter",
  other_label: "",
  ...type,
  content: { ...EMPTY_MEETING_CONTENT, ...patch },
});

describe("cleanMeetingContent", () => {
  it("drops blank rows and trims what is kept", () => {
    const cleaned = cleanMeetingContent(
      draft({
        decisions: [
          { text: "  Raise dues  ", vote: null, headline: "  " },
          BLANK_MINUTES_ROW.decision(),
        ],
        action_items: [
          BLANK_MINUTES_ROW.actionItem(),
          { text: " Book the hall ", owner_user_id: null, due_date: null },
        ],
        dates: [
          { date: "2026-11-28", text: " Installation " },
          { date: "", text: "No day yet" },
          BLANK_MINUTES_ROW.date(),
        ],
        tabled: [BLANK_MINUTES_ROW.tabled()],
      }).content,
    );
    expect(cleaned.decisions).toEqual([
      { text: "Raise dues", vote: null, headline: null },
    ]);
    expect(cleaned.action_items.map((item) => item.text)).toEqual([
      "Book the hall",
    ]);
    expect(cleaned.dates).toEqual([
      { date: "2026-11-28", text: "Installation" },
    ]);
    expect(cleaned.tabled).toEqual([]);
  });

  it("leaves text sections as typed", () => {
    expect(
      cleanMeetingContent(draft({ summary: " Hi " }).content).summary,
    ).toBe(" Hi ");
  });
});

describe("sameMinutesDraft", () => {
  it("treats a trailing space or an empty row as no change", () => {
    const stored = draft({ summary: "We met." });
    expect(sameMinutesDraft(stored, draft({ summary: "We met. " }))).toBe(true);
    expect(
      sameMinutesDraft(
        stored,
        draft({
          summary: "We met.",
          decisions: [BLANK_MINUTES_ROW.decision()],
        }),
      ),
    ).toBe(true);
  });

  it("sees a word or a type change", () => {
    const stored = draft({ summary: "We met." });
    expect(sameMinutesDraft(stored, draft({ summary: "We met twice." }))).toBe(
      false,
    );
    expect(
      sameMinutesDraft(
        stored,
        draft({ summary: "We met." }, { meeting_type: "exec" }),
      ),
    ).toBe(false);
  });

  it("ignores the Other label unless the type is Other", () => {
    expect(minutesStoredForm(draft({}, { other_label: "Retreat" }))).toBe(
      minutesStoredForm(draft({})),
    );
  });
});

describe("minutesEditDraftOf", () => {
  it("reads stored minutes, filling what is missing", () => {
    const read = minutesEditDraftOf({
      meeting_type: "other",
      other_label: null,
      content: { summary: "Hi", decisions: "not a list" },
    });
    expect(read.other_label).toBe("");
    expect(read.content.summary).toBe("Hi");
    expect(read.content.decisions).toEqual([]);
  });
});

describe("clampMeetingVote", () => {
  it("keeps a count whole and in range", () => {
    expect(clampMeetingVote("12")).toBe(12);
    expect(clampMeetingVote("")).toBe(0);
    expect(clampMeetingVote("-3")).toBe(0);
    expect(clampMeetingVote("4.7")).toBe(4);
    expect(clampMeetingVote("99999999")).toBe(MEETING_VOTE_MAX);
  });
});

describe("minutesDatesMissingDay", () => {
  it("finds a Coming up row with words and no day, ignoring blank ones", () => {
    const content = (dates: { date: string; text: string }[]) => ({
      ...EMPTY_MEETING_CONTENT,
      dates,
    });
    expect(minutesDatesMissingDay(content([{ date: "", text: "  " }]))).toBe(
      false,
    );
    expect(
      minutesDatesMissingDay(content([{ date: "2026-12-01", text: "Formal" }])),
    ).toBe(false);
    expect(
      minutesDatesMissingDay(content([{ date: "", text: "Formal" }])),
    ).toBe(true);
  });
});

describe("Tabling from the agenda", () => {
  const agenda = [
    { id: "a1", text: "Budget", done: false },
    { id: "a2", text: "  ", done: false },
    {
      id: "a3",
      text: "Formal",
      done: false,
      tabled_from: {
        meeting_id: "m0",
        start_time: "2026-11-02T23:00:00Z",
        times: 2,
      },
    },
  ];

  it("offers each agenda item with words that isn't tabled yet", () => {
    const tabled = [{ ...BLANK_MINUTES_ROW.tabled(), text: "budget" }];
    expect(minutesTablingOffers(agenda, tabled).map((item) => item.id)).toEqual(
      ["a3"],
    );
  });

  it("starts a new item at once, and carries one tabled before", () => {
    expect(tabledRowFromAgenda(agenda[0]!)).toEqual({
      text: "Budget",
      first_meeting_id: null,
      first_start_time: null,
      times: 1,
    });
    expect(tabledRowFromAgenda(agenda[2]!)).toEqual({
      text: "Formal",
      first_meeting_id: "m0",
      first_start_time: "2026-11-02T23:00:00Z",
      times: 3,
    });
    expect(
      tabledRowFromAgenda({
        ...agenda[2]!,
        tabled_from: {
          ...agenda[2]!.tabled_from,
          times: MEETING_TABLED_MAX_TIMES,
        },
      }).times,
    ).toBe(MEETING_TABLED_MAX_TIMES);
  });
});

describe("meetingDraftQuote", () => {
  const review = {
    sources: [
      {
        kind: "decision" as const,
        text: "Dues rise",
        quote: "dues up",
        from: "Sam",
      },
    ],
  };
  it("names the line and whose it was, while the text is the drafted text", () => {
    expect(
      meetingDraftQuote(review as never, "decision", "Dues rise", "Sam"),
    ).toEqual({ quote: "dues up", from: "Sam", mine: true });
    expect(
      meetingDraftQuote(review as never, "decision", "Dues rise", "Alex")?.mine,
    ).toBe(false);
    expect(
      meetingDraftQuote(review as never, "decision", "Rewritten", "Sam"),
    ).toBeNull();
  });
});
