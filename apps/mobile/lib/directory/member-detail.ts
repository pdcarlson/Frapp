/**
 * Narrowing and derivation for the mobile member profile detail sheet (s13
 * row tap), over `GET /v1/members/{id}` and `GET /v1/roles`.
 *
 * `spec/behavior/members.md` names the detail-view fields explicitly: "name,
 * email, role, joined date." The self-report alumni fields (bio, graduation
 * year, city, company) are layered in the same way `lib/more/profile.ts`
 * already draws them on the viewer's own profile — they are already part of
 * `GET /v1/members/{id}`'s response for anyone holding `members:view` (every
 * seeded role), unlike point balance, which needs the officer-only
 * `points:view_all` and is deliberately omitted here.
 */
import { formatGraduationYear } from "../more/profile";
import { initialsFor, isRecord, metaLine, num, records, str } from "../more/narrow";

export interface MemberDetail {
  userId: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  email: string | null;
  bio: string | null;
  /** e.g. `"Acme Inc. · Chicago · '27"`, or `null` when nothing is known. */
  meta: string | null;
  /** e.g. `"Aug 21, 2026"`, or `null` when the timestamp can't be parsed. */
  joinedLabel: string | null;
  roleIds: string[];
}

export function selectMemberDetail(data: unknown): MemberDetail | null {
  if (!isRecord(data)) return null;
  const userId = str(data, "user_id");
  if (!userId) return null;
  const rawDisplayName = str(data, "display_name");
  const roleIdsRaw = data.role_ids;

  return {
    userId,
    // `display_name` is `NOT NULL DEFAULT ''`, so absent and empty are the
    // same "no name set" case — matches `DirectoryRow`'s fallback.
    displayName: rawDisplayName ?? "Unnamed member",
    initials: initialsFor(rawDisplayName),
    avatarUrl: str(data, "avatar_url"),
    email: str(data, "email"),
    bio: str(data, "bio"),
    meta: metaLine([
      str(data, "current_company"),
      str(data, "current_city"),
      formatGraduationYear(num(data, "graduation_year")),
    ]),
    joinedLabel: formatJoinedDate(str(data, "created_at")),
    roleIds: Array.isArray(roleIdsRaw)
      ? roleIdsRaw.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function formatJoinedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * `role_ids` → role names, resolved off `GET /v1/roles`.
 *
 * That endpoint declares no response schema (`openapi-typescript` infers
 * `never`), so it is read defensively like every other undeclared read in
 * this app rather than cast. A role id with no match (a since-deleted role,
 * or the list still loading) is dropped rather than rendered as a raw id.
 */
export function resolveRoleNames(rolesData: unknown, roleIds: string[]): string[] {
  if (roleIds.length === 0) return [];
  const byId = new Map<string, string>();
  for (const row of records(rolesData)) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (id && name) byId.set(id, name);
  }
  return roleIds
    .map((id) => byId.get(id))
    .filter((name): name is string => !!name);
}
