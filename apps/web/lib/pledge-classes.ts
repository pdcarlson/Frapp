import { MEMBER_ORDER_NUMBER_MAX, parseOrderNumber } from "@repo/validation";
import type { PledgeClassAssignment } from "@repo/hooks";

/** One member in the class editor: who, and the number as it is being typed. */
export type ClassEditorRow = {
  memberId: string;
  name: string;
  /** The order number's text, or "" for none. */
  number: string;
};

/**
 * The rows' numbers after the rows were put in a new order, or one was added.
 * The numbers follow the list (#5738): there is no number to type in the
 * class editor.
 *
 * The numbers the rows already hold are kept and dealt back out lowest first,
 * and a row without one takes the next number after the highest. A chapter
 * that numbers everyone chapter-wide (a roll or bond number) keeps the numbers
 * this class holds, 41 to 52 say, and only who holds which changes; a class
 * with no numbers yet is numbered 1 to n. A row past `MEMBER_ORDER_NUMBER_MAX`
 * is left without one.
 */
export function renumberRows(
  rows: readonly ClassEditorRow[],
): ClassEditorRow[] {
  const held = rows
    .map((row) => parseOrderNumber(row.number))
    .filter((value): value is number => typeof value === "number");
  let next = Math.max(0, ...held);
  const fresh = Array.from({ length: rows.length - held.length }, () => ++next);
  const dealt = [...held, ...fresh]
    .filter((value) => value <= MEMBER_ORDER_NUMBER_MAX)
    .sort((a, b) => a - b);
  return rows.map((row, index) => ({
    ...row,
    number: dealt[index] === undefined ? "" : String(dealt[index]),
  }));
}

/** The rows with a member added at the end, as the newest of the class. */
export function addRow(
  rows: readonly ClassEditorRow[],
  added: Omit<ClassEditorRow, "number">,
): ClassEditorRow[] {
  return renumberRows([...rows, { ...added, number: "" }]);
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
 * `members` is the roster as it stood when the editor opened, not the live
 * read. Only a member who was in the class then, and whose row the officer
 * took out, is removed; someone another officer added to the class meanwhile
 * is not in the editor and is left alone.
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
