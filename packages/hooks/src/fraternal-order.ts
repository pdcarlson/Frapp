/**
 * Fraternal order: the sort a chapter's pledge classes and its members' order
 * numbers make (`spec/behavior/members.md` § Pledge class and order number).
 *
 * Oldest class first, then order number within the class, lowest first, then
 * name. A member with a class and no number follows the numbered members of
 * that class. Members with no class come after every class, ordered by their
 * number, and members with neither come last, by name.
 *
 * One definition for web and mobile, and for the class editor, which lists a
 * class's members in the order the Directory will show them.
 */

/** The fields of a member the sort reads. */
export type FraternalOrderMember = {
  pledge_class_id?: string | null;
  order_number?: number | null;
  display_name?: string | null;
};

/** A pledge class as the sort reads it: the list's order is the chapter's. */
type OrderedClass = { id: string };

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A comparator for `Array.prototype.sort`, built from the chapter's classes in
 * the order `GET /v1/pledge-classes` returns them (oldest first).
 *
 * A member pointing at a class the list doesn't hold (deleted since the member
 * read, or a list that failed to load) sorts as having no class rather than
 * ahead of everyone.
 */
export function fraternalOrderComparator(
  classes: readonly OrderedClass[],
): (a: FraternalOrderMember, b: FraternalOrderMember) => number {
  const position = new Map(classes.map((entry, index) => [entry.id, index]));
  const classRank = (member: FraternalOrderMember) =>
    (member.pledge_class_id
      ? position.get(member.pledge_class_id)
      : undefined) ?? Number.POSITIVE_INFINITY;

  return (a, b) => {
    const rankA = classRank(a);
    const rankB = classRank(b);
    if (rankA !== rankB) return rankA < rankB ? -1 : 1;

    const numberA = numberOrNull(a.order_number);
    const numberB = numberOrNull(b.order_number);
    if (numberA !== numberB) {
      if (numberA === null) return 1;
      if (numberB === null) return -1;
      return numberA - numberB;
    }

    return (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, {
      sensitivity: "base",
    });
  };
}

/**
 * Whether the chapter uses pledge classes or order numbers at all. A chapter
 * with no classes and no numbers sees no pledge class or order controls
 * outside the place an officer sets them up.
 */
export function usesFraternalOrder(
  classes: readonly OrderedClass[] | null | undefined,
  members: readonly FraternalOrderMember[] | null | undefined,
): boolean {
  if ((classes?.length ?? 0) > 0) return true;
  return (members ?? []).some(
    (member) =>
      numberOrNull(member.order_number) !== null || !!member.pledge_class_id,
  );
}
