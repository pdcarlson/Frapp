import { describe, expect, it } from "vitest";
import {
  welcomeCardEventWhen,
  welcomeCardEvents,
  welcomeCardTitle,
  welcomeDueMark,
  readWelcomeDueMark,
  WELCOME_CARD_DAYS,
} from "./welcome-card";

// Thursday, November 19, 2026, 3:00 PM local.
const NOW = new Date(2026, 10, 19, 15, 0);
const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour, 0).toISOString();

describe("welcomeCardTitle", () => {
  it("greets by first name, or by the chapter alone", () => {
    expect(welcomeCardTitle("Phi Gamma Delta", "Paul Carlson")).toBe(
      "Welcome to Phi Gamma Delta, Paul",
    );
    expect(welcomeCardTitle("Phi Gamma Delta", "  ")).toBe(
      "Welcome to Phi Gamma Delta",
    );
    // Ask's rule: an email-made name gets no greeting by name.
    expect(welcomeCardTitle("Phi Gamma Delta", "jlee42")).toBe(
      "Welcome to Phi Gamma Delta",
    );
    expect(welcomeCardTitle("Phi Gamma Delta", "Member")).toBe(
      "Welcome to Phi Gamma Delta",
    );
    expect(welcomeCardTitle(null, "Paul")).toBe(
      "Welcome to your chapter, Paul",
    );
  });
});

describe("welcomeCardEventWhen", () => {
  it("writes the day out, with the time inside the week", () => {
    expect(welcomeCardEventWhen(at(19, 19), NOW)).toBe("Today, 7:00 PM");
    expect(welcomeCardEventWhen(at(20, 19), NOW)).toBe("Tomorrow, 7:00 PM");
    expect(welcomeCardEventWhen(at(22, 19), NOW)).toBe("Sunday, 7:00 PM");
    expect(welcomeCardEventWhen(at(28, 10), NOW)).toBe("Saturday, November 28");
    expect(
      welcomeCardEventWhen(new Date(2027, 0, 9, 10).toISOString(), NOW),
    ).toBe("Saturday, January 9, 2027");
  });

  it("says an event already under way is happening, not Today", () => {
    // A retreat that began yesterday evening and runs through tomorrow.
    expect(welcomeCardEventWhen(at(18, 19), NOW)).toBe("Happening now");
    expect(welcomeCardEventWhen(at(19, 14), NOW)).toBe("Happening now");
  });

  it("says nothing for a date it can't read", () => {
    expect(welcomeCardEventWhen("not a date", NOW)).toBe("");
  });
});

describe("welcomeCardEvents", () => {
  it("keeps the next two, soonest first, counting one still running", () => {
    const events = [
      { id: "c", name: "Car wash", start_time: at(22, 10) },
      { id: "past", name: "Old", start_time: at(18, 19), end_time: at(18, 20) },
      {
        id: "now",
        name: "Study hours",
        start_time: at(19, 14),
        end_time: at(19, 17),
      },
      { id: "m", name: "Chapter meeting", start_time: at(23, 19) },
    ];
    expect(welcomeCardEvents(events, NOW).map((e) => e.id)).toEqual([
      "now",
      "c",
    ]);
    expect(welcomeCardEvents(undefined, NOW)).toEqual([]);
  });
});

describe("welcome-due mark", () => {
  it("reads back who and which chapter while it is due", () => {
    const mark = welcomeDueMark("u-1", "ch-1", NOW);
    expect(readWelcomeDueMark(mark, NOW)).toEqual({
      userId: "u-1",
      chapterKey: "ch-1",
    });
  });

  it("lapses after a week, so What's new isn't held for good", () => {
    const mark = welcomeDueMark("u-1", "ch-1", NOW);
    const later = (days: number) =>
      new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
    expect(
      readWelcomeDueMark(mark, later(WELCOME_CARD_DAYS - 0.5)),
    ).not.toBeNull();
    expect(readWelcomeDueMark(mark, later(WELCOME_CARD_DAYS + 0.5))).toBeNull();
  });

  it("is not due for nothing stored or a mark it can't read", () => {
    expect(readWelcomeDueMark(null, NOW)).toBeNull();
    expect(readWelcomeDueMark("u-1:ch-1", NOW)).toBeNull();
    expect(readWelcomeDueMark("u-1:ch-1:soon", NOW)).toBeNull();
  });
});
