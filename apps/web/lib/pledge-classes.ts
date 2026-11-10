import { MEMBER_ORDER_NUMBER_MAX } from "@repo/validation";
import type { PledgeClassAssignment } from "@repo/hooks";

/**
 * The plural of a chapter's word for a class, for a heading over the list:
 * "Pledge class" becomes "Pledge classes", "Line" becomes "Lines". The word is
 * the chapter's own, so this only knows the two regular English endings.
 */
export function pluralTerm(term: string): string {
  const word = term.trim();
  if (!word) return word;
  return /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;
}

/** A term inside a sentence: "Fraternal order" reads "fraternal order". */
export function lowerTerm(term: string): string {
  const word = term.trim();
  return word.charAt(0).toLowerCase() + word.slice(1);
}

/** One member in the class editor: who, and the number as it is being typed. */
export type ClassEditorRow = {
  memberId: string;
  name: string;
  /** The order number's text, or "" for none. */
  number: string;
};

/**
 * An order number from its text: an integer from 1 to the column's bound,
 * `null` for a blank field, and `undefined` for anything else.
 */
export function parseOrderNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 1 && value <= MEMBER_ORDER_NUMBER_MAX ? value : undefined;
}

/**
 * The rows' numbers after the rows were put in a new order.
 *
 * When every row already holds a number, the same numbers are dealt back out
 * lowest first. A chapter that numbers everyone chapter-wide (a roll or bond
 * number) keeps the numbers this class holds, 41 to 52 say, and only who holds
 * which changes. Otherwise the rows are numbered 1 to n, which is what a
 * chapter that orders people inside a class wants from a first drag.
 */
export function renumberRows(rows: readonly ClassEditorRow[]): ClassEditorRow[] {
  const numbers = rows.map((row) => parseOrderNumber(row.number));
  const allNumbered = numbers.every(
    (value): value is number => typeof value === "number",
  );
  const dealt = allNumbered
    ? [...(numbers as number[])].sort((a, b) => a - b)
    : rows.map((_, index) => index + 1);
  return rows.map((row, index) => ({ ...row, number: String(dealt[index]) }));
}

/** The number a member added to the end of the class starts with. */
export function nextOrderNumber(rows: readonly ClassEditorRow[]): string {
  const numbers = rows.map((row) => parseOrderNumber(row.number));
  if (!numbers.every((value): value is number => typeof value === "number")) {
    return "";
  }
  const next = Math.max(0, ...numbers) + 1;
  return next <= MEMBER_ORDER_NUMBER_MAX ? String(next) : "";
}

type SavedMember = {
  id: string;
  pledge_class_id: string | null;
  order_number: number | null;
};

/**
 * What saving the class editor writes: one assignment per member whose class
 * or number changed, and nothing for a member left as they were.
 *
 * A member taken out of the class loses the class and keeps their number, as a
 * member of a deleted class does (`spec/behavior/members.md`). Returns `null`
 * while any number is not one the API takes.
 */
export function classAssignments(
  classId: string,
  rows: readonly ClassEditorRow[],
  members: readonly SavedMember[],
): PledgeClassAssignment[] | null {
  const saved = new Map(members.map((member) => [member.id, member]));
  const kept = new Set(rows.map((row) => row.memberId));
  const assignments: PledgeClassAssignment[] = [];

  for (const row of rows) {
    const number = parseOrderNumber(row.number);
    if (number === undefined) return null;
    const before = saved.get(row.memberId);
    if (
      before &&
      before.pledge_class_id === classId &&
      before.order_number === number
    ) {
      continue;
    }
    assignments.push({
      member_id: row.memberId,
      pledge_class_id: classId,
      order_number: number,
    });
  }

  for (const member of members) {
    if (member.pledge_class_id === classId && !kept.has(member.id)) {
      assignments.push({
        member_id: member.id,
        pledge_class_id: null,
        order_number: member.order_number,
      });
    }
  }

  return assignments;
}
