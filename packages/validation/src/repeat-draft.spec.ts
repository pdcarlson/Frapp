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
  repeatEditAnchor,
  repeatRuleForEdit,
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

  it("defaults Weekly to the first meeting's weekday, 13 meetings, sent as the token", () => {
    const draft = pickRepeatPreset(noRepeatDraft(NY), "WEEKLY");
    expect(repeatDays(draft, START)).toEqual(["TU"]);
    // Exactly what `WEEKLY` makes, so shipped phones can read it.
    expect(ruleOf(draft)).toBe("WEEKLY");
    // A token's dates read in the device's zone, UTC here.
    expect(repeatCaption(draft, START)?.text).toMatch(
      /^13 meetings, the last on Feb/,
    );
    expect(ruleOf(editRepeatDraft(draft, { countInput: "14" }))).toBe(
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=14;TZID=America/New_York",
    );
  });

  it("sends the legacy token only for exactly a token's series", () => {
    const weekly = pickRepeatPreset(noRepeatDraft(NY), "WEEKLY");
    expect(
      ruleOf(editRepeatDraft(weekly, { intervalInput: "2", countInput: "7" })),
    ).toBe("BIWEEKLY");
    expect(ruleOf(toggleRepeatDay(weekly, "MO", START))).toContain(
      "BYDAY=MO,TU",
    );
    // The 12th, 7 PM in New York, is the 12th in UTC too.
    const twelfth = new Date("2026-11-12T23:00:00Z");
    const monthly = pickRepeatPreset(noRepeatDraft(NY), "MONTHLY");
    expect(ruleOf(monthly, twelfth)).toBe("MONTHLY");
    // 9 PM on the 12th is the 13th in UTC, where the token would step.
    expect(ruleOf(monthly, new Date("2026-11-13T02:00:00Z"))).toContain(
      "BYMONTHDAY=12",
    );
    expect(
      ruleOf(editRepeatDraft(monthly, { monthlyBy: "nth" }), twelfth),
    ).toContain("BYDAY=2TH");
    expect(ruleOf(pickRepeatPreset(noRepeatDraft(NY), "DAILY"))).toContain(
      "FREQ=DAILY",
    );
    expect(ruleOf(pickRepeatEnd(weekly, "until", START))).toContain("UNTIL=");
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
      countInput: "8",
    });
    // Feb 28, 2027, 7 PM in New York.
    const feb = new Date("2027-03-01T00:00:00Z");
    expect(monthlyChoices(draft, feb)[0]?.label).toBe("day 31");
    expect(ruleOf(draft, feb)).toContain("BYMONTHDAY=31;COUNT=8");
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

  describe("editing a series", () => {
    const DAY = 86_400_000;
    const RULE =
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=10;TZID=America/New_York";
    const before = new Date("2026-11-01T12:00:00Z");

    it("anchors on the head moved by the save's shift", () => {
      expect(
        repeatEditAnchor({
          headStart: START,
          headRule: RULE,
          shiftMs: DAY,
          now: before,
        }).toISOString(),
      ).toBe("2026-11-12T00:00:00.000Z");
    });

    it("anchors on the next meeting once the head has started", () => {
      // Three weeks in: the next is Dec 1, the fourth meeting.
      const now = new Date("2026-11-27T12:00:00Z");
      const series = { headStart: START, headRule: RULE, shiftMs: 0, now };
      expect(repeatEditAnchor(series).toISOString()).toBe(
        "2026-12-02T00:00:00.000Z",
      );
      // COUNT is checked and counted from the new first meeting.
      const draft = editRepeatDraft(repeatDraftFromRule(RULE, NY), {
        countInput: "4",
      });
      const result = repeatRuleForEdit(draft, series);
      expect(result.ok && result.rule).toBe(
        RULE.replace("COUNT=10", "COUNT=4"),
      );
    });

    it("moves stored weekdays with a start moved in the same save", () => {
      const draft = editRepeatDraft(repeatDraftFromRule(RULE, NY), {
        countInput: "8",
      });
      const result = repeatRuleForEdit(draft, {
        headStart: START,
        headRule: RULE,
        shiftMs: DAY,
        now: before,
      });
      expect(result.ok && result.rule).toContain("BYDAY=WE;COUNT=8");
      // Days the officer picked are theirs.
      const picked = toggleRepeatDay(draft, "FR", START);
      const kept = repeatRuleForEdit(picked, {
        headStart: START,
        headRule: RULE,
        shiftMs: DAY,
        now: before,
      });
      expect(kept.ok && kept.rule).toContain("BYDAY=TU,FR");
    });

    it("gives back an untouched rule for the API to shift", () => {
      const result = repeatRuleForEdit(repeatDraftFromRule(RULE, NY), {
        headStart: START,
        headRule: RULE,
        shiftMs: DAY,
        now: before,
      });
      expect(result.ok && result.rule).toBe(RULE);
    });

    it("steps an occurrence's change from its parent, on another weekday", () => {
      // Editing a Thursday occurrence of a Tuesday series: the rule still
      // describes the Tuesday head.
      const draft = editRepeatDraft(repeatDraftFromRule(RULE, NY), {
        countInput: "6",
      });
      const result = repeatRuleForEdit(draft, {
        headStart: START,
        headRule: RULE,
        shiftMs: 0,
        now: before,
      });
      expect(result.ok && result.rule).toContain("BYDAY=TU;COUNT=6");
      expect(monthlyChoices(draft, START)[0]?.label).toBe("day 10");
    });
  });
});
