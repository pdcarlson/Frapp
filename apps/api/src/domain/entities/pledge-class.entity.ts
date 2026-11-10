/**
 * One of a chapter's pledge classes (`chapter_pledge_classes`, #3939).
 *
 * `position` orders the chapter's list, lowest first, which is oldest first.
 * The name is the chapter's own and carries no order (Greek letters don't sort
 * alphabetically). What a chapter calls a class is its `class` vocabulary
 * term; this row is the same thing under any name.
 */
export interface PledgeClass {
  id: string;
  chapter_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/** One member's class and order number, as an officer sets them together. */
export type PledgeClassAssignment = {
  member_id: string;
  pledge_class_id: string | null;
  order_number: number | null;
};
