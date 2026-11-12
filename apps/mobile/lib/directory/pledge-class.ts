/**
 * A member's pledge class and order number on mobile (#3939;
 * `spec/behavior/members.md` § Pledge class and order number).
 *
 * Shared by the member sheet (s13) and the viewer's own Profile (s15), so the
 * two draw the same rows under the same rules: `usePledgeClassRows` is the
 * whole of it for both. An officer holding `roles:manage` also sets them from
 * the member sheet (#3991), through `MemberClassSheet`; `classEditorResult`
 * is that editor's rule for what it sends.
 */
import {
  useCurrentChapter,
  usePledgeClasses,
  type PledgeClass,
} from "@repo/hooks";
import { memberViewVocabulary, vocab } from "@repo/org-archetypes";
import {
  ORDER_NUMBER_INVALID_MESSAGE,
  parseOrderNumber,
} from "@repo/validation";

/**
 * The chapter's own words for a pledge class and for a member's order number,
 * as typed: a chapter's word is free text, so it is never re-cased or
 * pluralized here. The IFC defaults until the chapter read answers.
 */
export function usePledgeClassTerms(): {
  classTerm: string;
  orderTerm: string;
} {
  const config = memberViewVocabulary(useCurrentChapter().data);
  return {
    classTerm: vocab("class", config),
    orderTerm: vocab("order", config),
  };
}

/** Class id to name, from the chapter's list. Empty for a list not read. */
export function classNamesById(
  classes: readonly Pick<PledgeClass, "id" | "name">[] | null | undefined,
): Map<string, string> {
  return new Map((classes ?? []).map((entry) => [entry.id, entry.name]));
}

export interface PledgeClassRow {
  key: "class" | "order";
  label: string;
  value: string;
}

/**
 * The detail rows a member's class and number make: each only when set, so a
 * chapter with no classes and no numbers sees neither. A viewer who can set
 * them (`showUnset`, an officer holding `roles:manage`) always sees both, an
 * unset one as "Not set", because the row is where they set it, as on web. A class whose name the
 * list hasn't answered yet reads "Loading", and one the list doesn't hold
 * (deleted since the member read, or a failed read) "Not available", the
 * words web's profile sheet uses for the same cases.
 */
export function pledgeClassRows({
  pledgeClassId,
  orderNumber,
  classNames,
  classesPending,
  classTerm,
  orderTerm,
  showUnset = false,
}: {
  pledgeClassId: string | null;
  orderNumber: number | null;
  classNames: ReadonlyMap<string, string>;
  classesPending: boolean;
  classTerm: string;
  orderTerm: string;
  showUnset?: boolean;
}): PledgeClassRow[] {
  const rows: PledgeClassRow[] = [];
  if (pledgeClassId !== null) {
    rows.push({
      key: "class",
      label: classTerm,
      value:
        classNames.get(pledgeClassId) ??
        (classesPending ? "Loading" : "Not available"),
    });
  } else if (showUnset) {
    rows.push({ key: "class", label: classTerm, value: NOT_SET });
  }
  if (orderNumber !== null) {
    rows.push({ key: "order", label: orderTerm, value: String(orderNumber) });
  } else if (showUnset) {
    rows.push({ key: "order", label: orderTerm, value: NOT_SET });
  }
  return rows;
}

/** An unset class or number, as an officer's row shows it (web's words). */
export const NOT_SET = "Not set";

/**
 * The rows for one member, for the sheet and for Profile: the chapter's words,
 * and the class list read for a member who has a class to name, or for an
 * officer who can set one (the editor's picker needs it).
 *
 * The last list read is kept when a refetch fails, as web's profile sheet
 * keeps it: a weak signal shouldn't turn a name already on screen into "Not
 * available". Only a list that has never answered leaves the name out.
 */
export function usePledgeClassRows(
  member: { pledgeClassId: string | null; orderNumber: number | null } | null,
  options: { canEdit?: boolean } = {},
): PledgeClassRow[] {
  const canEdit = options.canEdit === true;
  const { classTerm, orderTerm } = usePledgeClassTerms();
  // An editor needs the list for the picker too, so it is read for them
  // whether or not this member has a class.
  const classesQuery = usePledgeClasses({
    enabled: !!member && (canEdit || !!member.pledgeClassId),
  });
  if (!member) return [];
  return pledgeClassRows({
    pledgeClassId: member.pledgeClassId,
    orderNumber: member.orderNumber,
    classNames: classNamesById(classesQuery.data),
    classesPending: classesQuery.isPending,
    classTerm,
    orderTerm,
    showUnset: canEdit,
  });
}

/** What the class editor (#3991) holds while an officer edits one member. */
export interface ClassEditorDraft {
  /** The picked class's id, or `null` for none. */
  pledgeClassId: string | null;
  /** The order number as typed, `""` for none. */
  numberText: string;
}

export type ClassEditorResult =
  | {
      ok: true;
      /** Whether the draft differs from the saved values; Save is off when not. */
      changed: boolean;
      pledge_class_id: string | null;
      order_number: number | null;
    }
  | { ok: false; message: string };

/**
 * The class the editor shows as picked. A class id the chapter's list doesn't
 * hold (deleted since the member was read, which nulls it on the server) reads
 * as None once the list has answered, so the picker always shows a choice and
 * Save never sends an id the API refuses with "Class not found". `null` for
 * `knownIds` is a list not yet read, which leaves the id as it is.
 */
export function shownClassId(
  pledgeClassId: string | null,
  knownIds: ReadonlySet<string> | null,
): string | null {
  if (pledgeClassId === null || knownIds === null) return pledgeClassId;
  return knownIds.has(pledgeClassId) ? pledgeClassId : null;
}

/**
 * What the editor would send for a draft: `PUT /v1/pledge-classes/assignments`
 * takes both values for the member, so both always go together, as web's
 * profile sheet sends them. A number the API would refuse is refused here
 * with the shared words, before anything is sent. The class sent is the one
 * {@link shownClassId} shows.
 */
export function classEditorResult(
  saved: { pledgeClassId: string | null; orderNumber: number | null },
  draft: ClassEditorDraft,
  knownIds: ReadonlySet<string> | null = null,
): ClassEditorResult {
  const orderNumber = parseOrderNumber(draft.numberText);
  if (orderNumber === undefined) {
    return { ok: false, message: ORDER_NUMBER_INVALID_MESSAGE };
  }
  const pledgeClassId = shownClassId(draft.pledgeClassId, knownIds);
  return {
    ok: true,
    changed:
      pledgeClassId !== saved.pledgeClassId ||
      orderNumber !== saved.orderNumber,
    pledge_class_id: pledgeClassId,
    order_number: orderNumber,
  };
}

/** The draft an editor opens on: the member's saved values. */
export function classEditorDraft(saved: {
  pledgeClassId: string | null;
  orderNumber: number | null;
}): ClassEditorDraft {
  return {
    pledgeClassId: saved.pledgeClassId,
    numberText: saved.orderNumber === null ? "" : String(saved.orderNumber),
  };
}
