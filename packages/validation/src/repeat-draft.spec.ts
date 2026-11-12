import { describe, expect, it } from "vitest";
import {
  editRepeatDraft,
  monthlyChoices,
  noRepeatDraft,
  pickRepeatEnd,
  pickRepeatPreset,
  repeatCaption,
  repeatDays,
  repeatDraftFromRule,
  repeatRuleOf,
  repeatSummary,
  toggleRepeatDay,
} from "./repeat-draft";

const NY = "America/New_York";
// Tuesday, Nov 10, 2026, 7 PM in New York: the second Tuesday.
const START = new Date("2026-11-11T00:00:00Z");

function ruleOf(draft: ReturnType<typeof noRepeatDraft>, start = START) {
  const result = repeatRuleOf(draft, start);
  if (!result.ok) throw new Error(result.error);
  return result.rule;
}

describe("repeat draft", () => {
  it("is one-time by default", () => {
    expect(ruleOf(noRepeatDraft(NY))).toBeNull();
    expect(repeatCaption(noRepeatDraft(NY), START)).toBeNull();
    expect(repeatSummary(noRepeatDraft(NY), START)).toBe("Doesn't repeat");
  });

  it("defaults Weekly to the first meeting's weekday, 13 meetings", () => {
    const draft = pickRepeatPreset(noRepeatDraft(NY), "WEEKLY");
    expect(repeatDays(draft, START)).toEqual(["TU"]);
    expect(ruleOf(draft)).toBe(
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=13;TZID=America/New_York",
    );
    expect(repeatCaption(draft, START)?.text).toBe(
      "13 meetings, the last on Feb 2, 2027.",
    );
  });

  it("makes twice a week from two chips, in week order", () => {
    let draft = pickRepeatPreset(noRepeatDraft(NY), "WEEKLY");
    draft = toggleRepeatDay(draft, "MO", START);
    expect(ruleOf(draft)).toContain("BYDAY=MO,TU");
    expect(repeatSummary(draft, START)).toBe("Every Mon and Tue");
  });

  it("keeps the last weekday chip on", () => {
    const draft = pickRepeatPreset(noRepeatDraft(NY), "WEEKLY");
    expect(toggleRepeatDay(draft, "TU", START)).toBe(draft);
  });

  it("offers the date, the nth weekday and, in the last week, the last", () => {
    const draft = pickRepeatPreset(noRepeatDraft(NY), "MONTHLY");
    expect(monthlyChoices(draft, START).map((c) => c.label)).toEqual([
      "day 10",
      "the second Tuesday",
    ]);
    // Tuesday, Nov 24: the fourth and the last.
    const late = new Date("2026-11-25T00:00:00Z");
    expect(monthlyChoices(draft, late).map((c) => c.by)).toEqual([
      "date",
      "nth",
      "last",
    ]);
    // Tuesday, Dec 29: a fifth, offered only as the last.
    const fifth = new Date("2026-12-30T00:00:00Z");
    expect(monthlyChoices(draft, fifth).map((c) => c.label)).toEqual([
      "day 29",
      "the last Tuesday",
    ]);
  });

  it("writes a monthly nth weekday", () => {
    const draft = editRepeatDraft(
      pickRepeatPreset(noRepeatDraft(NY), "MONTHLY"),
      { monthlyBy: "nth", intervalInput: "2" },
    );
    expect(ruleOf(draft)).toBe(
      "FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU;COUNT=7;TZID=America/New_York",
    );
  });

  it("falls back to the date when the start no longer offers the choice", () => {
    const draft = editRepeatDraft(
      pickRepeatPreset(noRepeatDraft(NY), "MONTHLY"),
      { monthlyBy: "last" },
    );
    expect(ruleOf(draft)).not.toContain("BYDAY");
    expect(ruleOf(draft)).toContain("BYMONTHDAY=10");
  });

  it("keeps a series on the 31st there when its first meeting was clamped", () => {
    const rule =
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;COUNT=6;TZID=America/New_York";
    const draft = editRepeatDraft(repeatDraftFromRule(rule, NY), {
      countInput: "7",
    });
    // Feb 28, 2027, 7 PM in New York.
    const feb = new Date("2027-03-01T00:00:00Z");
    expect(monthlyChoices(draft, feb)[0]?.label).toBe("day 31");
    expect(ruleOf(draft, feb)).toContain("BYMONTHDAY=31;COUNT=7");
    // Moved to the 12th, it follows the start.
    const moved = new Date("2027-03-12T23:00:00Z");
    expect(ruleOf(draft, moved)).toContain("BYMONTHDAY=12");
  });

  it("offers the current count's last day when switching to an end date", () => {
    const weekly = pickRepeatPreset(noRepeatDraft(NY), "WEEKLY");
    const draft = pickRepeatEnd(weekly, "until", START);
    expect(draft.until).toBe("2027-02-02");
    expect(ruleOf(draft)).toContain("UNTIL=20270202");
  });

  it("says why it can't be saved", () => {
    const weekly = pickRepeatPreset(noRepeatDraft(NY), "WEEKLY");
    expect(
      repeatRuleOf(editRepeatDraft(weekly, { countInput: "1" }), START),
    ).toMatchObject({ ok: false, field: "count" });
    expect(
      repeatRuleOf(editRepeatDraft(weekly, { intervalInput: "" }), START),
    ).toMatchObject({ ok: false, field: "interval" });
    const early = editRepeatDraft(pickRepeatEnd(weekly, "until", START), {
      until: "2026-11-12",
    });
    expect(repeatCaption(early, START)).toEqual({
      text: "The end date leaves no meeting after the first. Choose a later end date.",
      problem: true,
    });
  });

  it("sends a legacy token back unchanged until it is edited", () => {
    const draft = repeatDraftFromRule("BIWEEKLY", NY);
    expect(draft.preset).toBe("WEEKLY");
    expect(draft.intervalInput).toBe("2");
    expect(draft.countInput).toBe("7");
    expect(ruleOf(draft)).toBe("BIWEEKLY");
    expect(repeatSummary(draft, START)).toBe("Every 2 weeks");
    const edited = editRepeatDraft(draft, { countInput: "5" });
    expect(ruleOf(edited)).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=5;TZID=America/New_York",
    );
  });

  it("reads a structured rule back to the same string", () => {
    const rule =
      "FREQ=MONTHLY;INTERVAL=1;BYDAY=-1TU;UNTIL=20270601;TZID=America/Chicago";
    const draft = repeatDraftFromRule(rule, NY);
    expect(draft).toMatchObject({
      preset: "MONTHLY",
      monthlyBy: "last",
      endKind: "until",
      until: "2027-06-01",
      timeZone: "America/Chicago",
    });
    const late = new Date("2026-11-25T01:00:00Z");
    expect(ruleOf(editRepeatDraft(draft, {}), late)).toBe(rule);
  });

  it("reads anything else as one-time", () => {
    expect(repeatDraftFromRule("YEARLY", NY).preset).toBe("NONE");
    expect(repeatDraftFromRule(null, NY).preset).toBe("NONE");
  });
});
