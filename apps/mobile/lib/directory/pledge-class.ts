/**
 * A member's pledge class and order number on mobile, read-only (#3939;
 * `spec/behavior/members.md` § Pledge class and order number). Officers set
 * them on web; editing on mobile is #3991.
 *
 * Shared by the member sheet (s13) and the viewer's own Profile (s15), so the
 * two draw the same rows under the same rules.
 */
import { useCurrentChapter, type PledgeClass } from "@repo/hooks";
import { memberViewVocabulary, vocab } from "@repo/org-archetypes";

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
 * chapter with no classes and no numbers sees neither. A class whose name the
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
}: {
  pledgeClassId: string | null;
  orderNumber: number | null;
  classNames: ReadonlyMap<string, string>;
  classesPending: boolean;
  classTerm: string;
  orderTerm: string;
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
  }
  if (orderNumber !== null) {
    rows.push({ key: "order", label: orderTerm, value: String(orderNumber) });
  }
  return rows;
}
