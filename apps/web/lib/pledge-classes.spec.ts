import { describe, expect, it } from "vitest";
import {
  addRow,
  classAssignments,
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

  it("numbers 1 to n when no row has a number", () => {
    expect(
      renumberRows([row("b", ""), row("a", "")]).map((entry) => entry.number),
    ).toEqual(["1", "2"]);
  });

  it("keeps the numbers rows hold and counts on from the highest for the rest", () => {
    expect(
      renumberRows([row("b", ""), row("a", "41"), row("c", "47")]).map(
        (entry) => [entry.memberId, entry.number],
      ),
    ).toEqual([
      ["b", "41"],
      ["a", "47"],
      ["c", "48"],
    ]);
  });
});

describe("addRow", () => {
  it("adds a member at the end, one past the highest number", () => {
    expect(
      addRow([row("a", "41"), row("b", "42")], {
        memberId: "c",
        name: "c",
      }).map((entry) => entry.number),
    ).toEqual(["41", "42", "43"]);
  });

  it("leaves everyone else's number alone, blank ones included", () => {
    expect(
      addRow([row("a", "1"), row("b", "")], { memberId: "c", name: "c" }).map(
        (entry) => entry.number,
      ),
    ).toEqual(["1", "", "2"]);
  });

  it("gives no number in a class that has none (#3967)", () => {
    expect(
      addRow([row("a", "")], { memberId: "b", name: "b" }).map(
        (entry) => entry.number,
      ),
    ).toEqual(["", ""]);
    expect(addRow([], { memberId: "a", name: "a" })[0]?.number).toBe("");
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
