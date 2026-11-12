/**
 * Narrowing for s13 (Directory), over `GET /v1/members`, `/v1/members/search`
 * and `/v1/alumni`.
 *
 * All three return the same `MemberProfile` shape, so one row selector serves
 * every tab and the search results drop straight into the same list.
 *
 * ## Why `useMembers()` and not the roster projection
 *
 * #986 and #1000 objected to `useMembers()` for chat display names, because
 * resolving a name should not put every member's email, bio and city on a
 * device — that is what `GET /v1/members/roster` exists for. The directory is
 * the opposite case: it is the surface `/v1/members` was built for, and the
 * roster projection carries no role or graduation year, so it cannot draw the
 * meta line the reference specifies.
 */
import {
  formatGraduationYear,
  fraternalOrderComparator,
  memberLabel,
} from "@repo/hooks";
import { initialsFor, metaLine, num, records, str } from "./narrow";

export interface DirectoryRow {
  /**
   * `members.id`, the id `GET /v1/members/{id}` takes. Not `userId`: the
   * profile route looks the member row up by its own id, so passing the user
   * id there is a 404 for every member.
   */
  memberId: string;
  /** `users.id`, the id every other surface keys members on. */
  userId: string;
  displayName: string;
  initials: string;
  /** e.g. `"CS '27"`, or `null` when nothing is known. */
  meta: string | null;
  avatarUrl: string | null;
  /** The member's pledge class and order number (#3939), each `null` when unset. */
  pledgeClassId: string | null;
  orderNumber: number | null;
}

export interface DirectoryRowOptions {
  /**
   * The chapter's pledge class names by id. A member's class leads their meta
   * line when its name is here; leave it out (the list failed, or hasn't
   * answered) and no row names a class.
   */
  classNames?: ReadonlyMap<string, string>;
  /**
   * The chapter's classes, oldest first, to list the rows in fraternal order
   * (`fraternalOrderComparator`, the one definition of that sort) instead of
   * by name.
   */
  fraternalOrder?: readonly { id: string }[];
}

function toRow(
  row: Record<string, unknown>,
  classNames?: ReadonlyMap<string, string>,
): DirectoryRow | null {
  const memberId = str(row, "id");
  const userId = str(row, "user_id");
  if (!memberId || !userId) return null;

  // `display_name` is `NOT NULL DEFAULT ''`, so absent and empty are the same
  // case and both fall back rather than rendering a blank row — to the label
  // web shows for the same member, so the two platforms agree on who it is.
  const displayName = memberLabel(str(row, "display_name"), userId);
  const pledgeClassId = str(row, "pledge_class_id");
  return {
    memberId,
    userId,
    displayName,
    initials: initialsFor(str(row, "display_name")),
    meta: metaLine([
      pledgeClassId ? (classNames?.get(pledgeClassId) ?? null) : null,
      str(row, "current_company"),
      str(row, "current_city"),
      formatGraduationYear(num(row, "graduation_year")),
    ]),
    avatarUrl: str(row, "avatar_url"),
    pledgeClassId,
    orderNumber: num(row, "order_number"),
  };
}

/**
 * Rows for either tab, alphabetical so the list is scannable by name, or in
 * the chapter's fraternal order when `fraternalOrder` carries its classes.
 */
export function selectDirectoryRows(
  data: unknown,
  { classNames, fraternalOrder }: DirectoryRowOptions = {},
): DirectoryRow[] {
  const rows = records(data)
    .map((row) => toRow(row, classNames))
    .filter((row): row is DirectoryRow => !!row);
  if (!fraternalOrder) {
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  const compare = fraternalOrderComparator(fraternalOrder);
  const sortable = (row: DirectoryRow) => ({
    pledge_class_id: row.pledgeClassId,
    order_number: row.orderNumber,
    // Already the label the row shows, which is what the sort ties on.
    display_name: row.displayName,
    user_id: row.userId,
  });
  return rows.sort((a, b) => compare(sortable(a), sortable(b)));
}

/**
 * The Actives tab's half of `GET /v1/members`: everyone the server did not
 * flag `is_alumni` (#2484). The endpoint returns the whole chapter because its
 * other consumers need the whole chapter, so the split is made here, on the
 * flag the server resolves exactly as it resolves `GET /v1/alumni`, which is
 * what keeps the two chips from counting one member twice.
 *
 * A row without the flag (an API older than the field) counts as active, which
 * is the unfiltered list this screen showed before the split.
 */
export function selectActives(data: unknown): Record<string, unknown>[] {
  return records(data).filter((row) => row.is_alumni !== true);
}
