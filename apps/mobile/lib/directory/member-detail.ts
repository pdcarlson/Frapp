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
  userId: string;
  displayName: string;
  initials: string;
  email: string | null;
  bio: string | null;
  /** e.g. `"Acme Inc. · Chicago · '27"`, or `null` when nothing is known. */
  meta: string | null;
  /** e.g. `"Aug 21, 2026"`, or `null` when the timestamp can't be parsed. */
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
    userId,
    // `display_name` is `NOT NULL DEFAULT ''`, so absent and empty are the
    // same "no name set" case — matches `DirectoryRow`'s fallback.
    displayName: rawDisplayName ?? "Unnamed member",
    initials: initialsFor(rawDisplayName),
    email: str(data, "email"),
    bio: str(data, "bio"),
    meta: metaLine([
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

/**
 * `role_ids` → role names, resolved off `GET /v1/roles`.
 *
 * That endpoint declares no response schema (`openapi-typescript` infers
 * `never`), so it is read defensively like every other undeclared read in
 * this app rather than cast. A role id with no match (a since-deleted role,
 * or the list still loading) is dropped rather than rendered as a raw id,
 * and a duplicate id (the API does not dedupe `role_ids` — see
 * `member.service.spec.ts`) contributes its name only once.
 */
export function resolveRoleNames(rolesData: unknown, roleIds: string[]): string[] {
  if (roleIds.length === 0) return [];
  const byId = new Map<string, string>();
  for (const row of records(rolesData)) {
    const id = str(row, "id");
    const name = str(row, "name");
    if (id && name) byId.set(id, name);
  }
  return [...new Set(roleIds)]
    .map((id) => byId.get(id))
    .filter((name): name is string => !!name);
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
