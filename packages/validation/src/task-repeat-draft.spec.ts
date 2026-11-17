import { describe, expect, it } from "vitest";
import {
  editRepeatDraft,
  noRepeatDraft,
  noTaskRepeatDraft,
  pickRepeatEnd,
  pickRepeatPreset,
  repeatRuleOf,
  taskRepeatCaption,
  taskRepeatDraftFromRule,
  taskRepeatRuleOf,
  taskRepeatSummary,
  taskSaveScope,
  taskSeriesLine,
} from "./repeat-draft";

const NY = "America/New_York";
// Monday Nov 16 2026, 9 PM in New York.
const FIRST = new Date("2026-11-17T02:00:00.000Z");

describe("a task's Repeat control (#5119)", () => {
  it("starts with no repeat and an open end", () => {
    const draft = noTaskRepeatDraft(NY);
    expect(draft.preset).toBe("NONE");
    expect(draft.endKind).toBe("never");
    expect(taskRepeatRuleOf(draft, FIRST)).toEqual({ ok: true, rule: null });
    expect(taskRepeatCaption(draft, FIRST)).toBeNull();
  });

  it("makes a never-ending weekly rule on the first copy's weekday", () => {
    const draft = pickRepeatPreset(noTaskRepeatDraft(NY), "WEEKLY");
    expect(taskRepeatRuleOf(draft, FIRST)).toEqual({
      ok: true,
      rule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=${NY}`,
    });
    expect(taskRepeatSummary(draft, FIRST)).toBe("Every Monday");
    expect(taskRepeatCaption(draft, FIRST)).toEqual({
      text: "Repeats until you stop it.",
      problem: false,
    });
  });

  it("never sends a legacy token, which an event's control would", () => {
    const weekly = pickRepeatEnd(
      pickRepeatPreset(noTaskRepeatDraft(NY), "WEEKLY"),
      "count",
      FIRST,
    );
    const rule = taskRepeatRuleOf(weekly, FIRST);
    expect(rule).toEqual({
      ok: true,
      rule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=13;TZID=${NY}`,
    });
    expect(
      repeatRuleOf(pickRepeatPreset(noRepeatDraft(NY), "WEEKLY"), FIRST),
    ).toEqual({ ok: true, rule: "WEEKLY" });
  });

  it("says how many times a counted series runs and when it ends", () => {
    const draft = editRepeatDraft(
      pickRepeatEnd(
        pickRepeatPreset(noTaskRepeatDraft(NY), "WEEKLY"),
        "count",
        FIRST,
      ),
      { countInput: "4" },
    );
    expect(taskRepeatCaption(draft, FIRST)).toEqual({
      text: "4 times, the last on Dec 7.",
      problem: false,
    });
  });

  it("refuses an end date that leaves no copy after the first", () => {
    const draft = editRepeatDraft(
      pickRepeatEnd(
        pickRepeatPreset(noTaskRepeatDraft(NY), "WEEKLY"),
        "until",
        FIRST,
      ),
      { until: "2026-11-20" },
    );
    const result = taskRepeatRuleOf(draft, FIRST);
    expect(result.ok).toBe(false);
    expect(taskRepeatCaption(draft, FIRST)?.problem).toBe(true);
  });

  it("an event's control refuses Never", () => {
    const draft = pickRepeatEnd(
      pickRepeatPreset(noRepeatDraft(NY), "WEEKLY"),
      "never",
      FIRST,
    );
    expect(repeatRuleOf(draft, FIRST).ok).toBe(false);
  });

  it("reads a stored task rule back, and sends it untouched", () => {
    const rule = `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;TZID=${NY}`;
    const draft = taskRepeatDraftFromRule(rule, "UTC");
    expect(draft).toMatchObject({
      preset: "WEEKLY",
      intervalInput: "2",
      byDay: ["MO", "TH"],
      endKind: "never",
      timeZone: NY,
      pristine: true,
    });
    expect(taskRepeatRuleOf(draft, FIRST)).toEqual({ ok: true, rule });
  });
});

describe("taskSeriesLine (#5119)", () => {
  const series = {
    recurrence_rule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=${NY}`,
    next_due_date: "2026-11-23",
    ended: false,
  };

  it("says the pattern, and the next copy's day when asked", () => {
    expect(taskSeriesLine(series, FIRST)).toBe("Every Monday");
    expect(taskSeriesLine(series, FIRST, { next: true })).toBe(
      "Every Monday · next Nov 23",
    );
  });

  it("says nothing for a task with no series, or one that ended", () => {
    expect(taskSeriesLine(null, FIRST)).toBeNull();
    expect(taskSeriesLine({ ...series, ended: true }, FIRST)).toBeNull();
  });
});

describe("taskSaveScope (#5119)", () => {
  const copy = {
    due_date: "2026-11-16",
    series: { ended: false },
  };

  it("asks on a copy of a live series", () => {
    expect(taskSaveScope(copy, { due_date: "2026-11-16" })).toBe("ask");
    expect(taskSaveScope(copy, {})).toBe("ask");
  });

  it("takes the series for a Repeat change, the copy for a new day", () => {
    expect(taskSaveScope(copy, { recurrence_rule: null })).toBe("series");
    expect(taskSaveScope(copy, { due_date: "2026-11-18" })).toBe("instance");
  });

  it("never asks on a task with no live series", () => {
    expect(taskSaveScope({ due_date: "2026-11-16" }, {})).toBe("instance");
    expect(taskSaveScope({ ...copy, series: { ended: true } }, {})).toBe(
      "instance",
    );
  });
});
