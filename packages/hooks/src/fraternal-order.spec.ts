import { describe, expect, test } from "vitest";
import { fraternalOrderComparator, usesFraternalOrder } from "./fraternal-order";

const CLASSES = [{ id: "alpha" }, { id: "beta" }];

function member(
  display_name: string,
  pledge_class_id: string | null,
  order_number: number | null,
) {
  return { display_name, pledge_class_id, order_number };
}

function sorted(members: ReturnType<typeof member>[]) {
  return [...members]
    .sort(fraternalOrderComparator(CLASSES))
    .map((entry) => entry.display_name);
}

describe("fraternalOrderComparator", () => {
  test("oldest class first, then number, then members with neither", () => {
    expect(
      sorted([
        member("Neither", null, null),
        member("Beta 1", "beta", 1),
        member("Alpha 2", "alpha", 2),
        member("Alpha 1", "alpha", 1),
      ]),
    ).toEqual(["Alpha 1", "Alpha 2", "Beta 1", "Neither"]);
  });

  test("a member with a class and no number follows that class's numbered members", () => {
    expect(
      sorted([
        member("Alpha unnumbered", "alpha", null),
        member("Beta 1", "beta", 1),
        member("Alpha 9", "alpha", 9),
      ]),
    ).toEqual(["Alpha 9", "Alpha unnumbered", "Beta 1"]);
  });

  test("members with no class come after every class, by number, then by name", () => {
    expect(
      sorted([
        member("Zed", null, null),
        member("Abe", null, null),
        member("Roll 40", null, 40),
        member("Roll 7", null, 7),
        member("Beta unnumbered", "beta", null),
      ]),
    ).toEqual(["Beta unnumbered", "Roll 7", "Roll 40", "Abe", "Zed"]);
  });

  test("equal numbers fall back to name, ignoring case", () => {
    expect(
      sorted([
        member("bob", "alpha", 3),
        member("Al", "alpha", 3),
        member("Cy", "alpha", 3),
      ]),
    ).toEqual(["Al", "bob", "Cy"]);
  });

  test("a class the list doesn't hold sorts as no class", () => {
    expect(
      sorted([member("Stale 1", "deleted", 1), member("Beta 5", "beta", 5)]),
    ).toEqual(["Beta 5", "Stale 1"]);
  });

  test("the chapter's order decides, not the class id", () => {
    const comparator = fraternalOrderComparator([{ id: "beta" }, { id: "alpha" }]);
    expect(
      [member("A", "alpha", 1), member("B", "beta", 1)]
        .sort(comparator)
        .map((entry) => entry.display_name),
    ).toEqual(["B", "A"]);
  });
});

describe("usesFraternalOrder", () => {
  test("false for a chapter with no classes and no numbers", () => {
    expect(usesFraternalOrder([], [member("A", null, null)])).toBe(false);
    expect(usesFraternalOrder(undefined, undefined)).toBe(false);
  });

  test("true once the chapter has a class, even with nobody in it", () => {
    expect(usesFraternalOrder(CLASSES, [member("A", null, null)])).toBe(true);
  });

  test("true for a chapter that keeps only a chapter-wide number", () => {
    expect(usesFraternalOrder([], [member("A", null, 12)])).toBe(true);
  });
});
