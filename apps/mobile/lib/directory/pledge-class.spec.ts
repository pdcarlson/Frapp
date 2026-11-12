import { describe, expect, it } from "vitest";
import { ORDER_NUMBER_INVALID_MESSAGE } from "@repo/validation";
import {
  classEditorDraft,
  classEditorResult,
  classNamesById,
  NOT_SET,
  pledgeClassRows,
  shownClassId,
} from "./pledge-class";

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

describe("pledgeClassRows for an officer who can set them (#3991)", () => {
  it("draws both rows, an unset one as Not set", () => {
    expect(
      pledgeClassRows({
        pledgeClassId: null,
        orderNumber: null,
        classNames: NAMES,
        classesPending: false,
        ...TERMS,
        showUnset: true,
      }),
    ).toEqual([
      { key: "class", label: "Line", value: NOT_SET },
      { key: "order", label: "Line number", value: NOT_SET },
    ]);
  });

  it("draws set values as everyone sees them", () => {
    expect(
      pledgeClassRows({
        pledgeClassId: "pc-1",
        orderNumber: null,
        classNames: NAMES,
        classesPending: false,
        ...TERMS,
        showUnset: true,
      }).map((row) => row.value),
    ).toEqual(["Alpha", NOT_SET]);
  });
});

describe("classEditorResult (#3991)", () => {
  const saved = { pledgeClassId: "pc-1", orderNumber: 4 };

  it("opens on the saved values, unchanged", () => {
    expect(classEditorResult(saved, classEditorDraft(saved))).toEqual({
      ok: true,
      changed: false,
      pledge_class_id: "pc-1",
      order_number: 4,
    });
  });

  it("sends both values together when either changes", () => {
    expect(
      classEditorResult(saved, { pledgeClassId: "pc-2", numberText: "4" }),
    ).toEqual({
      ok: true,
      changed: true,
      pledge_class_id: "pc-2",
      order_number: 4,
    });
    expect(
      classEditorResult(saved, { pledgeClassId: "pc-1", numberText: " 12 " }),
    ).toMatchObject({ changed: true, order_number: 12 });
  });

  it("clears both: no class and a blank number", () => {
    expect(
      classEditorResult(saved, { pledgeClassId: null, numberText: "" }),
    ).toEqual({
      ok: true,
      changed: true,
      pledge_class_id: null,
      order_number: null,
    });
  });

  it.each(["0", "1.5", "abc", "-3"])("refuses the number %s", (text) => {
    expect(
      classEditorResult(saved, { pledgeClassId: "pc-1", numberText: text }),
    ).toEqual({ ok: false, message: ORDER_NUMBER_INVALID_MESSAGE });
  });

  it("opens a member with no number on a blank field", () => {
    expect(
      classEditorDraft({ pledgeClassId: null, orderNumber: null }),
    ).toEqual({ pledgeClassId: null, numberText: "" });
  });
});

describe("a class deleted since the member was read (#3991)", () => {
  const known = new Set(["pc-1", "pc-2"]);

  it("shows as None once the list has answered, and as is before", () => {
    expect(shownClassId("pc-gone", known)).toBeNull();
    expect(shownClassId("pc-gone", null)).toBe("pc-gone");
    expect(shownClassId("pc-1", known)).toBe("pc-1");
    expect(shownClassId(null, known)).toBeNull();
  });

  it("sends None rather than an id the API refuses", () => {
    expect(
      classEditorResult(
        { pledgeClassId: "pc-gone", orderNumber: 4 },
        { pledgeClassId: "pc-gone", numberText: "5" },
        known,
      ),
    ).toEqual({
      ok: true,
      changed: true,
      pledge_class_id: null,
      order_number: 5,
    });
  });
});
