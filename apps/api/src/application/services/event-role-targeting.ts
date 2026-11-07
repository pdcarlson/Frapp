/**
 * `spec/behavior/events.md` § `required_role_ids` wire semantics: `null` and
 * `[]` are both "untargeted" (visible/counted for everyone). The single
 * predicate every role-targeting check goes through, so a future change to
 * the matching rule (e.g. also honouring `custom_role_ids`) can't be applied
 * to one call site and missed on another.
 */
export function hasRequiredRole(
  requiredRoleIds: string[] | null | undefined,
  memberRoleIds: readonly string[],
): boolean {
  if (!requiredRoleIds || requiredRoleIds.length === 0) return true;
  return requiredRoleIds.some((roleId) => memberRoleIds.includes(roleId));
}

/**
 * What an event asks of one member: to be there (`required`), that they may
 * come (`optional`), or nothing, because it is not for them (`not_invited`).
 * The push names it ("Required") and the announcement skips `not_invited`.
 *
 * The rule today mirrors `AttendanceService.resolveRequiredMembers`, which
 * decides who is reminded and auto-marked absent, so a push never calls an
 * event required that the attendance sweep would not hold the member to:
 *
 * - **Role-targeted** (`required_role_ids` non-empty): a member holding one of
 *   the roles is required, whatever `is_mandatory` says; anyone else is not
 *   invited (they cannot even read the event, #1463).
 * - **Mandatory, untargeted**: required, except alumni, who cannot check in.
 * - **Otherwise**: optional.
 *
 * Per-role attendance (optional and excluded roles beside required ones) is
 * being added in the event forms rework; it replaces this body with the shared
 * resolver and keeps the signature.
 */
export type EventAttendance = 'required' | 'optional' | 'not_invited';

export function eventAttendanceFor(
  event: { is_mandatory: boolean; required_role_ids?: string[] | null },
  memberRoleIds: readonly string[],
  alumniRoleId: string | null,
): EventAttendance {
  if (event.required_role_ids && event.required_role_ids.length > 0) {
    return hasRequiredRole(event.required_role_ids, memberRoleIds)
      ? 'required'
      : 'not_invited';
  }
  if (!event.is_mandatory) return 'optional';
  return alumniRoleId && memberRoleIds.includes(alumniRoleId)
    ? 'optional'
    : 'required';
}
