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
import { initialsFor, metaLine, num, records, str } from "./narrow";
import { formatGraduationYear } from "./profile";

export interface DirectoryRow {
  /** `users.id` — the id every other surface keys members on. */
  userId: string;
  displayName: string;
  initials: string;
  /** e.g. `"CS '27"`, or `null` when nothing is known. */
  meta: string | null;
  avatarUrl: string | null;
}

function toRow(row: Record<string, unknown>): DirectoryRow | null {
  const userId = str(row, "user_id");
  if (!userId) return null;

  // `display_name` is `NOT NULL DEFAULT ''`, so absent and empty are the same
  // case and both fall back rather than rendering a blank row.
  const displayName = str(row, "display_name") ?? "Unnamed member";
  return {
    userId,
    displayName,
    initials: initialsFor(str(row, "display_name")),
    meta: metaLine([
      str(row, "current_company"),
      str(row, "current_city"),
      formatGraduationYear(num(row, "graduation_year")),
    ]),
    avatarUrl: str(row, "avatar_url"),
  };
}

/** Rows for either tab, alphabetical so the list is scannable by name. */
export function selectDirectoryRows(data: unknown): DirectoryRow[] {
  return records(data)
    .map(toRow)
    .filter((row): row is DirectoryRow => !!row)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
