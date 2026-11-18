import { describe, expect, it } from "vitest";
import {
  ACTIVITY_DEFAULT_CARD_ORDER,
  activityCardRole,
  activityLayoutBody,
  arrangeActivityCards,
  hideActivityCard,
  moveActivityCard,
  sameActivityArrangement,
  showActivityCard,
} from "./activity-cards";
import { ACTIVITY_CARD_KEYS } from "@repo/validation";

const saved = (card_order: string[], hidden_cards: string[] = []) => ({
  card_order,
  hidden_cards,
  saved: true,
});

describe("activityCardRole", () => {
  it("is officer for anyone who confirms tasks or approves hours", () => {
    expect(activityCardRole(["tasks:manage"])).toBe("officer");
    expect(activityCardRole(["service:approve"])).toBe("officer");
    expect(activityCardRole(["*"])).toBe("officer");
  });
  it("is member otherwise, and while permissions are unknown", () => {
    expect(activityCardRole(["members:view"])).toBe("member");
    expect(activityCardRole(undefined)).toBe("member");
  });
});

describe("the role defaults", () => {
  it("list every card once", () => {
    for (const order of Object.values(ACTIVITY_DEFAULT_CARD_ORDER)) {
      expect([...order].sort()).toEqual([...ACTIVITY_CARD_KEYS].sort());
    }
  });
  it("put an officer's queue before their own work, and a member's work first", () => {
    const officer = ACTIVITY_DEFAULT_CARD_ORDER.officer;
    expect(officer.indexOf("review")).toBeLessThan(officer.indexOf("todo"));
    const member = ACTIVITY_DEFAULT_CARD_ORDER.member;
    expect(member.indexOf("todo")).toBeLessThan(member.indexOf("review"));
  });
});

describe("arrangeActivityCards", () => {
  it("is the role's default while nothing is saved or the read is out", () => {
    expect(arrangeActivityCards(undefined, "officer")).toEqual({
      shown: [...ACTIVITY_DEFAULT_CARD_ORDER.officer],
      hidden: [],
    });
    expect(
      arrangeActivityCards(
        { card_order: ["links"], hidden_cards: [], saved: false },
        "member",
      ).shown,
    ).toEqual([...ACTIVITY_DEFAULT_CARD_ORDER.member]);
  });

  it("keeps the member's order and hidden cards", () => {
    const all = [...ACTIVITY_DEFAULT_CARD_ORDER.member].reverse();
    const layout = saved(
      all.filter((k) => k !== "links"),
      ["links"],
    );
    expect(arrangeActivityCards(layout, "member")).toEqual({
      shown: all.filter((k) => k !== "links"),
      hidden: ["links"],
    });
  });

  it("skips keys it doesn't know and repeats", () => {
    const order = [...ACTIVITY_DEFAULT_CARD_ORDER.member];
    const layout = saved(["future-card", ...order, "todo"], ["also-new"]);
    expect(arrangeActivityCards(layout, "member")).toEqual({
      shown: order,
      hidden: [],
    });
  });

  it("puts a card never placed after the card before it in the default", () => {
    // Saved before `waiting` existed, with `semester` moved first.
    const layout = saved([
      "semester",
      "nudge",
      "recap",
      "review",
      "todo",
      "calendar",
      "reminders",
      "links",
    ]);
    const { shown } = arrangeActivityCards(layout, "officer");
    expect(shown.indexOf("waiting")).toBe(shown.indexOf("calendar") + 1);
    expect(shown[0]).toBe("semester");
  });

  it("puts a never-placed card first when nothing before it is shown", () => {
    const layout = saved(
      ["todo"],
      [
        "recap",
        "review",
        "calendar",
        "waiting",
        "semester",
        "reminders",
        "links",
      ],
    );
    expect(arrangeActivityCards(layout, "officer").shown).toEqual([
      "nudge",
      "todo",
    ]);
  });

  it("never shows a card the member hid, even if a client also listed it", () => {
    const layout = saved(["todo", "links"], ["links"]);
    const arranged = arrangeActivityCards(layout, "member");
    expect(arranged.shown).not.toContain("links");
    expect(arranged.hidden).toEqual(["links"]);
  });
});

describe("To do", () => {
  it("can't be hidden, and a stored hide of it is ignored", () => {
    const start = arrangeActivityCards(undefined, "member");
    expect(hideActivityCard(start, "todo")).toBe(start);
    const arranged = arrangeActivityCards(
      { card_order: ["links"], hidden_cards: ["todo"], saved: true },
      "member",
    );
    expect(arranged.hidden).not.toContain("todo");
    expect(arranged.shown).toContain("todo");
  });
});

describe("editing", () => {
  const start = arrangeActivityCards(undefined, "officer");

  it("moves a card one place, and not off either end", () => {
    const down = moveActivityCard(start, "nudge", 1);
    expect(down.shown.slice(0, 2)).toEqual(["recap", "nudge"]);
    expect(moveActivityCard(start, "nudge", -1)).toBe(start);
    expect(moveActivityCard(start, "links", 1)).toBe(start);
  });

  it("hides and brings back a card where the default puts it", () => {
    const hidden = hideActivityCard(start, "review");
    expect(hidden.shown).not.toContain("review");
    expect(hidden.hidden).toEqual(["review"]);
    const back = showActivityCard(hidden, "review", "officer");
    expect(back).toEqual(start);
  });

  it("knows when nothing changed", () => {
    const moved = moveActivityCard(start, "todo", -1);
    expect(sameActivityArrangement(start, moved)).toBe(false);
    expect(
      sameActivityArrangement(start, moveActivityCard(moved, "todo", 1)),
    ).toBe(true);
  });

  it("writes the body the API takes", () => {
    expect(activityLayoutBody({ shown: ["todo"], hidden: ["links"] })).toEqual({
      card_order: ["todo"],
      hidden_cards: ["links"],
    });
  });
});
