/**
 * Narrowing and derivation for the mobile member profile detail sheet (s13
 * row tap), over `GET /v1/members/{id}` and `GET /v1/roles`.
 *
 * `spec/behavior/members.md` names the detail-view fields explicitly: "name,
 * email, role, joined date." The self-report alumni fields (bio, graduation
 * year, city, company) and admin-defined custom fields are layered in too —
 * `custom_fields` is already server-filtered to what the requesting viewer
 * may see (`spec/behavior/members.md` § Custom Fields: "visibility is
 * enforced server-side"), so it needs no client-side gate. Point balance is
 * the one card field deliberately omitted: `GET /v1/points/members/{userId}`
 * needs the officer-only `points:view_all`, which most viewers of this sheet
 * do not hold — the same "omit, don't fake" call `lib/more/profile.ts`
 * already makes for the drawn attendance stat no member can read.
 */
import { parseInstant } from "@repo/formatting";
import { memberLabel } from "@repo/hooks";
import { roleColorOrNull } from "@repo/validation";
import { formatGraduationYear } from "../more/profile";
import {
  initialsFor,
  isRecord,
  metaLine,
  num,
  records,
  str,
} from "../more/narrow";

export interface MemberCustomField {
  fieldId: string;
  label: string;
  /** Already display-formatted — booleans as Yes/No, empty as "—". */
  value: string;
}

export interface MemberDetail {
  /** The membership row's id, which a role edit (`PATCH /v1/members/{id}/roles`) takes. */
  memberId: string | null;
  userId: string;
  /** Signed photo URL, or `null` for initials. */
  avatarUrl: string | null;
  displayName: string;
  initials: string;
  email: string | null;
  bio: string | null;
  /**
   * e.g. `"Economics · Acme Inc. · Chicago · '27"`, or `null` when nothing is
   * known.
   */
  meta: string | null;
  /**
   * e.g. `"August 21, 2026"`, written out (no abbreviated months in the UI), or
   * `null` when the timestamp can't be parsed.
   */
  joinedLabel: string | null;
  roleIds: string[];
  customRoleIds: string[];
  customFields: MemberCustomField[];
}

export function selectMemberDetail(data: unknown): MemberDetail | null {
  if (!isRecord(data)) return null;
  const userId = str(data, "user_id");
  if (!userId) return null;
  const rawDisplayName = str(data, "display_name");

  return {
    memberId: str(data, "id"),
    userId,
    avatarUrl: str(data, "avatar_url"),
    // `display_name` is `NOT NULL DEFAULT ''`, so absent and empty are the
    // same "no name set" case — matches `DirectoryRow`'s fallback.
    displayName: memberLabel(rawDisplayName, userId),
    initials: initialsFor(rawDisplayName),
    email: str(data, "email"),
    bio: str(data, "bio"),
    meta: metaLine([
      str(data, "major"),
      str(data, "current_company"),
      str(data, "current_city"),
      formatGraduationYear(num(data, "graduation_year")),
    ]),
    joinedLabel: formatJoinedDate(str(data, "created_at")),
    roleIds: stringArray(data.role_ids),
    customRoleIds: stringArray(data.custom_role_ids),
    customFields: parseCustomFields(data.custom_fields),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function formatJoinedDate(value: string | null): string | null {
  const date = parseInstant(value);
  if (!date) return null;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * `MemberProfileDto.custom_fields`, already tier-filtered server-side. A
 * field missing an id or label is dropped rather than rendered blank.
 */
function parseCustomFields(data: unknown): MemberCustomField[] {
  if (!Array.isArray(data)) return [];
  return records(data).flatMap((row) => {
    const fieldId = str(row, "field_id");
    const label = str(row, "label");
    if (!fieldId || !label) return [];
    return [{ fieldId, label, value: formatCustomFieldValue(row) }];
  });
}

function formatCustomFieldValue(row: Record<string, unknown>): string {
  const raw = str(row, "value");
  if (raw === null) return "—";
  return str(row, "type") === "boolean" ? (raw === "true" ? "Yes" : "No") : raw;
}

/** One role as the profile draws it: a chip with its color dot. */
export interface MemberRoleChip {
  id: string;
  name: string;
  /** The role's palette color, or `null` for a plain chip. */
  color: string | null;
}

/**
 * `role_ids` → role chips, resolved off `GET /v1/roles` and ordered the way
 * the chapter ranks its roles (`display_order`, then name), so the member's
 * top role leads, the same rank that picks their name color (#3485, #3710).
 *
 * That endpoint declares no response schema (`openapi-typescript` infers
 * `never`), so it is read defensively like every other undeclared read in
 * this app rather than cast. A role id with no match (a since-deleted role,
 * or the list still loading) is dropped rather than rendered as a raw id,
 * and a duplicate id (the API does not dedupe `role_ids` — see
 * `member.service.spec.ts`) contributes its chip only once.
 */
export function resolveRoleChips(
  rolesData: unknown,
  roleIds: string[],
): MemberRoleChip[] {
  if (roleIds.length === 0) return [];
  const held = new Set(roleIds);
  const chips: Array<MemberRoleChip & { order: number }> = [];
  for (const row of records(rolesData)) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (!id || !name || !held.has(id)) continue;
    held.delete(id);
    chips.push({
      id,
      name,
      color: roleColorOrNull(str(row, "color")),
      order: num(row, "display_order") ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return chips
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ id, name, color }) => ({ id, name, color }));
}

/**
 * `custom_role_ids` → custom role labels, resolved off `GET /v1/custom-roles`
 * — a `chapter-config:view`-gated read, unlike `GET /v1/roles`. The caller is
 * expected to pass `undefined` when the viewer cannot resolve it (rather than
 * fetching a 403), so this degrades to nothing shown, never a raw id.
 */
export function resolveCustomRoleNames(
  customRolesData: readonly { id: string; label: string }[] | undefined,
  customRoleIds: string[],
): string[] {
  if (customRoleIds.length === 0 || !customRolesData) return [];
  const byId = new Map(customRolesData.map((role) => [role.id, role.label]));
  return [...new Set(customRoleIds)]
    .map((id) => byId.get(id))
    .filter((label): label is string => !!label);
}
