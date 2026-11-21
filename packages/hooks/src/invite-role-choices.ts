import { useMemo, useState } from "react";
import { EVERYONE_ROLE_NAME } from "@repo/validation";
import { parseChapterRoles, toRoleOptions } from "./chapter-roles";
import { useInvitableRoleIds, type ChapterLinkView } from "./use-invites";
import { useOrgConfig } from "./use-org-config";
import { useRoles } from "./use-roles";

/** What a role picker calls the Everyone role (#4191): joining with no role. */
const NO_ROLE_LABEL = "No role";

/**
 * The Everyone role's seeded name before #4191 renamed it Everyone
 * (`EVERYONE_ROLE_NAME`). A legacy chapter's role that predates the
 * `system_key` is found by it, and the API still reads it as Everyone, so a
 * picker can hold it before the roles load.
 */
export const LEGACY_MEMBER_ROLE_NAME = "Member";

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
export function useInviteRoleChoices(): {
  choices: InviteRoleChoice[];
  defaultRole: string | undefined;
} {
  const rolesQuery = useRoles();
  const invitableQuery = useInvitableRoleIds();
  const configQuery = useOrgConfig();
  const configuredId = configQuery.data?.default_invite_role_id;

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
      choices.find((choice) => choice.name === LEGACY_MEMBER_ROLE_NAME)?.name ??
      choices[0]?.name;
    return { choices, defaultRole };
  }, [rolesQuery.data, invitableQuery.data, configuredId]);

  return value;
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

/**
 * The chapter links section's state, on web and the phone alike (#5633): the
 * links to list (live and expired, at most one per role), the role the next
 * link joins at, and whether making it replaces that role's link.
 *
 * - `newRole` starts on the role a link made with no role would get, as the
 *   API reports it (`view.defaultRole`), since the chapter's configured
 *   default is an officer-only read the client may not have; until the view
 *   loads, or if its role isn't offered, on `roles.defaultRole`. A pick that
 *   has since left the list (a role deleted or ranked up) falls back the same.
 * - `canRemake` is false for a link whose role is no longer offered (renamed,
 *   deleted, or now above the caller): making a link for it would be refused,
 *   so its row offers only Turn off.
 */
export function useChapterLinkPicker(
  view: ChapterLinkView | undefined,
  roles: { choices: readonly InviteRoleChoice[]; defaultRole?: string },
) {
  const [picked, setPicked] = useState<string | null>(null);
  const offered = (role: string | null | undefined): role is string =>
    !!role && roles.choices.some((choice) => choice.name === role);
  const links = view?.links ?? [];
  const startOn = offered(view?.defaultRole)
    ? view.defaultRole
    : (roles.defaultRole ?? null);
  const newRole = offered(picked) ? picked : startOn;
  return {
    links,
    newRole,
    pick: setPicked,
    label: (role: string) => inviteRoleLabel(role, roles.choices),
    // Making a link for a role that has one, live or expired, replaces it.
    replaces: links.some((link) => link.role === newRole),
    canRemake: (role: string) => offered(role),
  };
}
