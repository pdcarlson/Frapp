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
  it("start both roles the same: the Frapp card, To do, then Running (#5779)", () => {
    expect(ACTIVITY_DEFAULT_CARD_ORDER.officer).toEqual([
      "nudge",
      "todo",
      "running",
    ]);
    expect(ACTIVITY_DEFAULT_CARD_ORDER.member).toEqual(
      ACTIVITY_DEFAULT_CARD_ORDER.officer,
    );
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
      all.filter((k) => k !== "running"),
      ["running"],
    );
    expect(arrangeActivityCards(layout, "member")).toEqual({
      shown: all.filter((k) => k !== "running"),
      hidden: ["running"],
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
    // Saved before `running` existed, with To do moved first.
    const layout = saved(["todo", "nudge"]);
    const { shown } = arrangeActivityCards(layout, "officer");
    expect(shown.indexOf("running")).toBe(shown.indexOf("todo") + 1);
    expect(shown).toEqual(["todo", "running", "nudge"]);
  });

  it("drops the cards #5779 took off the page from a saved arrangement", () => {
    const layout = saved(
      ["review", "todo", "links", "nudge", "running"],
      ["calendar", "semester"],
    );
    expect(arrangeActivityCards(layout, "officer")).toEqual({
      shown: ["todo", "nudge", "running"],
      hidden: [],
    });
  });

  it("reads To review and Waiting on others as Running in a save from before #5779", () => {
    // Shown: Running takes the first one's place.
    expect(
      arrangeActivityCards(
        saved(["todo", "waiting", "nudge", "review"], ["week"]),
        "officer",
      ),
    ).toEqual({ shown: ["todo", "running", "nudge"], hidden: [] });
    // One hidden, the other shown: still shown.
    expect(
      arrangeActivityCards(saved(["todo", "waiting"], ["review"]), "officer"),
    ).toEqual({ shown: ["nudge", "todo", "running"], hidden: [] });
    // Both hidden: Running stays hidden rather than coming back unasked.
    expect(
      arrangeActivityCards(
        saved(["nudge", "todo"], ["review", "waiting"]),
        "officer",
      ),
    ).toEqual({ shown: ["nudge", "todo"], hidden: ["running"] });
  });

  it("puts a never-placed card first when nothing before it is shown", () => {
    const layout = saved(["todo"], ["running", "review", "links"]);
    expect(arrangeActivityCards(layout, "officer").shown).toEqual([
      "nudge",
      "todo",
    ]);
  });

  it("never shows a card the member hid, even if a client also listed it", () => {
    const layout = saved(["todo", "running"], ["running"]);
    const arranged = arrangeActivityCards(layout, "member");
    expect(arranged.shown).not.toContain("running");
    expect(arranged.hidden).toEqual(["running"]);
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
    expect(down.shown.slice(0, 2)).toEqual(["todo", "nudge"]);
    expect(moveActivityCard(start, "nudge", -1)).toBe(start);
    expect(moveActivityCard(start, "running", 1)).toBe(start);
  });

  it("hides and brings back a card where the default puts it", () => {
    const hidden = hideActivityCard(start, "running");
    expect(hidden.shown).not.toContain("running");
    expect(hidden.hidden).toEqual(["running"]);
    const back = showActivityCard(hidden, "running", "officer");
    expect(back).toEqual(start);
  });

  it("knows when nothing changed", () => {
    const moved = moveActivityCard(start, "todo", -1);
    expect(sameActivityArrangement(start, moved)).toBe(false);
    expect(
      sameActivityArrangement(start, moveActivityCard(moved, "todo", 1)),
    ).toBe(true);
  });

  it("carries a newer client's cards through a save", () => {
    const stored = saved(
      ["future-a", "todo", "future-b", "future-c", "running"],
      ["future-hidden", "recap"],
    );
    const arranged = arrangeActivityCards(stored, "member");
    const moved = moveActivityCard(arranged, "running", -1);
    const body = activityLayoutBody(moved, stored);
    expect(body.card_order.indexOf("future-a")).toBe(0);
    // Still right after To do, and in the order they were stored.
    const todo = body.card_order.indexOf("todo");
    expect(body.card_order.slice(todo + 1, todo + 3)).toEqual([
      "future-b",
      "future-c",
    ]);
    // `recap` is a card #5779 took off the page: an older client still knows
    // it, so it stays hidden there.
    expect(body.hidden_cards).toEqual(["future-hidden", "recap"]);
  });

  it("carries the cards #5779 took off the page through a save", () => {
    const stored = saved(["review", "todo", "links", "nudge"], ["calendar"]);
    const body = activityLayoutBody(
      arrangeActivityCards(stored, "member"),
      stored,
    );
    // Running takes To review's place; the stored keys stay for older builds.
    expect(body.card_order).toEqual([
      "review",
      "running",
      "todo",
      "links",
      "nudge",
    ]);
    expect(body.hidden_cards).toEqual(["calendar"]);
  });

  it("keeps nothing extra when nothing was saved", () => {
    const body = activityLayoutBody(
      { shown: ["todo"], hidden: [] },
      { card_order: ["future"], hidden_cards: [], saved: false },
    );
    expect(body.card_order).toEqual(["todo"]);
  });

  it("writes the body the API takes", () => {
    expect(
      activityLayoutBody({ shown: ["todo"], hidden: ["running"] }),
    ).toEqual({
      card_order: ["todo"],
      hidden_cards: ["running"],
    });
  });
});
