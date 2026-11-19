import { describe, expect, it } from "vitest";
import { EMPTY_MEETING_CONTENT, MEETING_VOTE_MAX } from "./meetings";
import {
  BLANK_MINUTES_ROW,
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
