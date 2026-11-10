import { describe, expect, it } from "vitest";
import { classNamesById, pledgeClassRows } from "./pledge-class";

const TERMS = { classTerm: "Line", orderTerm: "Line number" };
const NAMES = classNamesById([
  { id: "pc-1", name: "Alpha" },
  { id: "pc-2", name: "Beta" },
]);

function rows(input: {
  pledgeClassId?: string | null;
  orderNumber?: number | null;
  classNames?: ReadonlyMap<string, string>;
  classesPending?: boolean;
}) {
  return pledgeClassRows({
    pledgeClassId: input.pledgeClassId ?? null,
    orderNumber: input.orderNumber ?? null,
    classNames: input.classNames ?? NAMES,
    classesPending: input.classesPending ?? false,
    ...TERMS,
  });
}

describe("pledgeClassRows (#3939)", () => {
  it("draws nothing for a member with no class and no number", () => {
    expect(rows({})).toEqual([]);
  });

  it("labels each row with the chapter's own word, as typed", () => {
    expect(rows({ pledgeClassId: "pc-2", orderNumber: 7 })).toEqual([
      { key: "class", label: "Line", value: "Beta" },
      { key: "order", label: "Line number", value: "7" },
    ]);
  });

  it("draws a number with no class, for a chapter that numbers chapter-wide", () => {
    expect(rows({ orderNumber: 112 })).toEqual([
      { key: "order", label: "Line number", value: "112" },
    ]);
  });

  it("says Loading until the class list answers", () => {
    expect(
      rows({
        pledgeClassId: "pc-1",
        classNames: classNamesById(null),
        classesPending: true,
      })[0]?.value,
    ).toBe("Loading");
  });

  it("says Not available for a class the list doesn't hold", () => {
    expect(rows({ pledgeClassId: "pc-gone" })[0]?.value).toBe("Not available");
    expect(
      rows({ pledgeClassId: "pc-1", classNames: classNamesById(undefined) })[0]
        ?.value,
    ).toBe("Not available");
  });
});
