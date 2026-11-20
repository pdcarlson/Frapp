import { useMemo } from "react";
import { EVERYONE_ROLE_NAME } from "@repo/validation";
import { parseChapterRoles, toRoleOptions } from "./chapter-roles";
import { useInvitableRoleIds } from "./use-invites";
import { useOrgConfig } from "./use-org-config";
import { useRoles } from "./use-roles";

/** What a role picker calls the Everyone role (#4191): joining with no role. */
export const NO_ROLE_LABEL = "No role";

/**
 * The Everyone role's seeded name before #4191, for a legacy role that
 * predates its `system_key`: the fallback default after the key.
 */
const SEEDED_MEMBER_ROLE_NAME = "Member";

/** A role an invite or a chapter link can grant, as a picker shows it. */
export type InviteRoleChoice = {
  id: string;
  /** What the API takes and stores (`invites.role`). */
  name: string;
  /** What the picker shows: the name, or `No role` for Everyone. */
  label: string;
};

/**
 * The roles the caller may hand out with an invite or a chapter link
 * (#4546, #5633), and which to start on, for web and the phone alike.
 *
 * - Locked roles (one holding `*`) are left out: an invite can't grant them.
 *   So is a role the caller couldn't invite someone into
 *   (`useInvitableRoleIds`); until that list loads, or if it fails, every
 *   other role is offered and the API still refuses the rest.
 * - Everyone is first, as `No role`, then the rest by name.
 * - `defaultRole` is the chapter's configured default invite role when it is
 *   one of these, else Everyone, as the API's own fallback lands
 *   (`InviteService.resolveInviteRole`), found by `system_key` and then by its
 *   seeded name, so a renamed Everyone is still the one. Never the
 *   alphabetically first role: on a chapter with no default set (most of
 *   them) that would be Alumni, and hand new members its restrictions. Only
 *   with neither does it take the first. The config read is officer-only
 *   (`chapter-config:view`); without it the default is Everyone.
 */
export function useInviteRoleChoices(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const rolesQuery = useRoles({ enabled });
  const invitableQuery = useInvitableRoleIds({ enabled });
  const configQuery = useOrgConfig();
  const configuredId = enabled
    ? configQuery.data?.default_invite_role_id
    : undefined;

  const value = useMemo(() => {
    const everyoneId = parseChapterRoles(rolesQuery.data).find(
      (role) => role.everyone,
    )?.id;
    const allowed = invitableQuery.data ? new Set(invitableQuery.data) : null;
    const choices: InviteRoleChoice[] = toRoleOptions(rolesQuery.data, "keep", {
      dropLocked: true,
    })
      .filter((role) => !allowed || allowed.has(role.id))
      .sort(
        (first, second) =>
          Number(second.id === everyoneId) - Number(first.id === everyoneId) ||
          first.name.localeCompare(second.name),
      )
      .map((role) => ({
        id: role.id,
        name: role.name,
        label: role.id === everyoneId ? NO_ROLE_LABEL : role.name,
      }));
    const defaultRole =
      choices.find((choice) => choice.id === configuredId)?.name ??
      choices.find((choice) => choice.id === everyoneId)?.name ??
      choices.find((choice) => choice.name === SEEDED_MEMBER_ROLE_NAME)?.name ??
      choices[0]?.name;
    return { choices, defaultRole };
  }, [rolesQuery.data, invitableQuery.data, configuredId]);

  return {
    ...value,
    isPending: rolesQuery.isPending,
    isError: rolesQuery.isError,
  };
}

/**
 * The label for an invite's or a link's stored role name: the picker's
 * label when the role is still offered, `No role` for Everyone by name, else
 * the name as stored (a role since renamed or deleted).
 */
export function inviteRoleLabel(
  roleName: string,
  choices: readonly InviteRoleChoice[],
): string {
  return (
    choices.find((choice) => choice.name === roleName)?.label ??
    (roleName === EVERYONE_ROLE_NAME ? NO_ROLE_LABEL : roleName)
  );
}
