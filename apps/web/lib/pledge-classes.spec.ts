import { describe, expect, it } from "vitest";
import {
  classAssignments,
  nextOrderNumber,
  renumberRows,
  type ClassEditorRow,
} from "./pledge-classes";

const row = (memberId: string, number: string): ClassEditorRow => ({
  memberId,
  name: memberId,
  number,
});

describe("renumberRows", () => {
  it("deals a chapter-wide set of numbers back out in the new order", () => {
    expect(
      renumberRows([row("c", "52"), row("a", "41"), row("b", "47")]).map(
        (entry) => [entry.memberId, entry.number],
      ),
    ).toEqual([
      ["c", "41"],
      ["a", "47"],
      ["b", "52"],
    ]);
  });

  it("numbers 1 to n when any row has no number", () => {
    expect(
      renumberRows([row("b", ""), row("a", "9")]).map((entry) => entry.number),
    ).toEqual(["1", "2"]);
  });
});

describe("nextOrderNumber", () => {
  it("is one past the highest when every row is numbered", () => {
    expect(nextOrderNumber([row("a", "3"), row("b", "8")])).toBe("9");
    expect(nextOrderNumber([])).toBe("1");
  });

  it("is blank when the class is not fully numbered", () => {
    expect(nextOrderNumber([row("a", "3"), row("b", "")])).toBe("");
  });
});

describe("classAssignments", () => {
  const members = [
    { id: "a", pledge_class_id: "alpha", order_number: 1 },
    { id: "b", pledge_class_id: "alpha", order_number: 2 },
    { id: "c", pledge_class_id: "beta", order_number: 7 },
    { id: "d", pledge_class_id: null, order_number: null },
  ];

  it("writes nothing for an untouched class", () => {
    expect(
      classAssignments("alpha", [row("a", "1"), row("b", "2")], members),
    ).toEqual([]);
  });

  it("writes only the members whose class or number changed", () => {
    expect(
      classAssignments(
        "alpha",
        [row("b", "1"), row("a", "2"), row("c", "3"), row("d", "")],
        members,
      ),
    ).toEqual([
      { member_id: "b", pledge_class_id: "alpha", order_number: 1 },
      { member_id: "a", pledge_class_id: "alpha", order_number: 2 },
      { member_id: "c", pledge_class_id: "alpha", order_number: 3 },
      { member_id: "d", pledge_class_id: "alpha", order_number: null },
    ]);
  });

  it("takes a removed member out of the class and keeps their number", () => {
    expect(classAssignments("alpha", [row("a", "1")], members)).toEqual([
      { member_id: "b", pledge_class_id: null, order_number: 2 },
    ]);
  });

  it("is null while a number is not one the API takes", () => {
    expect(classAssignments("alpha", [row("a", "0")], members)).toBeNull();
  });
});
