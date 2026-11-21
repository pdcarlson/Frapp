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
  taskFirstDue,
  taskRepeatCadence,
  taskSaveScope,
  taskSeriesBody,
  taskSeriesLine,
  TASK_SERIES_SCOPE_COPY,
} from "./repeat-draft";

const NY = "America/New_York";
// Monday November 16 2026, 9 PM in New York.
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
      text: "4 times, the last on December 7.",
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
      "Every Monday · next November 23",
    );
  });

  it("says nothing for a task with no series, or one that ended", () => {
    expect(taskSeriesLine(null, FIRST)).toBeNull();
    expect(taskSeriesLine({ ...series, ended: true }, FIRST)).toBeNull();
  });
});

describe("taskSaveScope (#5119)", () => {
  const copy = { status: "TODO", series: { ended: false } };
  const plain = { movesDay: false, changesOther: true };

  it("asks on the copy still to come", () => {
    expect(taskSaveScope(copy, plain)).toEqual({ kind: "ask" });
  });

  it("takes the series for a Repeat change on its own", () => {
    expect(
      taskSaveScope(copy, {
        recurrence_rule: null,
        movesDay: false,
        changesOther: false,
      }),
    ).toEqual({ kind: "series" });
  });

  it("refuses a Repeat change saved with other changes or a new day", () => {
    for (const edit of [
      { recurrence_rule: null, movesDay: false, changesOther: true },
      { recurrence_rule: null, movesDay: true, changesOther: false },
    ]) {
      expect(taskSaveScope(copy, edit)).toEqual({
        kind: "refuse",
        message: TASK_SERIES_SCOPE_COPY.repeatAlone,
      });
    }
  });

  it("keeps an overdue or done copy to itself, and its Repeat to the next", () => {
    for (const status of ["OVERDUE", "COMPLETED"]) {
      expect(taskSaveScope({ ...copy, status }, plain)).toEqual({
        kind: "instance",
      });
      expect(
        taskSaveScope(
          { ...copy, status },
          { recurrence_rule: null, movesDay: false, changesOther: false },
        ),
      ).toEqual({
        kind: "refuse",
        message: TASK_SERIES_SCOPE_COPY.repeatFromNext,
      });
    }
  });

  it("moves one copy's day without asking", () => {
    expect(taskSaveScope(copy, { movesDay: true, changesOther: true })).toEqual(
      { kind: "instance" },
    );
  });

  it("never asks on a task with no live series", () => {
    expect(taskSaveScope({ status: "TODO" }, plain)).toEqual({
      kind: "instance",
    });
    expect(taskSaveScope({ ...copy, series: { ended: true } }, plain)).toEqual({
      kind: "instance",
    });
  });
});

describe("taskRepeatCaption's end date (#5119)", () => {
  it("says the date of a far end rather than counting to it", () => {
    const draft = editRepeatDraft(
      pickRepeatEnd(
        pickRepeatPreset(noTaskRepeatDraft(NY), "DAILY"),
        "until",
        FIRST,
      ),
      { until: "2028-12-31" },
    );
    expect(taskRepeatCaption(draft, FIRST)).toEqual({
      text: "Repeats until December 31, 2028.",
      problem: false,
    });
  });
});

describe("the task helpers both apps share (#5119)", () => {
  it("reads a typed due as the moment the Repeat defaults from", () => {
    // A typed time is this device's clock, as the forms save it.
    expect(taskFirstDue("2026-11-16T21:00")).toEqual(
      new Date(2026, 10, 16, 21, 0),
    );
    // A day alone is noon in the rule's zone, so its weekday is that zone's.
    expect(taskFirstDue("2026-11-16", NY)?.toISOString()).toBe(
      "2026-11-16T17:00:00.000Z",
    );
    expect(taskFirstDue("2026-11-16")).toEqual(new Date(2026, 10, 16, 12));
    // A stored timestamp's tail isn't a typed time: it reads as its day.
    expect(taskFirstDue("2026-11-16T00:00:00Z", NY)?.toISOString()).toBe(
      "2026-11-16T17:00:00.000Z",
    );
    expect(taskFirstDue("")).toBeNull();
    expect(taskFirstDue("soon")).toBeNull();
  });

  it("says how often a copy comes in a word, for a phone row", () => {
    const series = (rule: string, ended = false) => ({
      recurrence_rule: rule,
      next_due_date: "2026-11-23",
      ended,
    });
    expect(
      taskRepeatCadence(series("FREQ=WEEKLY;BYDAY=MO;TZID=America/New_York")),
    ).toBe("Weekly");
    expect(taskRepeatCadence(series("FREQ=DAILY;TZID=America/New_York"))).toBe(
      "Daily",
    );
    expect(
      taskRepeatCadence(
        series("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;TZID=America/New_York"),
      ),
    ).toBe("Every 2 weeks");
    expect(
      taskRepeatCadence(
        series("FREQ=MONTHLY;BYMONTHDAY=16;TZID=America/New_York"),
      ),
    ).toBe("Monthly");
    expect(
      taskRepeatCadence(series("FREQ=WEEKLY;TZID=America/New_York", true)),
    ).toBeNull();
    expect(taskRepeatCadence(null)).toBeNull();
    expect(taskRepeatCadence(series("not a rule"))).toBeNull();
  });

  it("sends an All upcoming tasks write without the day", () => {
    expect(
      taskSeriesBody({
        title: "Kitchen duty",
        due_date: "2026-11-16",
        due_at: "2026-11-17T03:00:00.000Z",
      }),
    ).toEqual({
      title: "Kitchen duty",
      due_at: "2026-11-17T03:00:00.000Z",
      scope: "series",
    });
  });
});
