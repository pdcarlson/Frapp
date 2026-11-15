import {
  ROLE_PICKER_DEFAULT_TITLE,
  ROLE_PICKER_ROLES_MAX,
  ROLE_PICKER_TITLE_MAX_LENGTH,
} from '@repo/validation';

/**
 * Rules for a role picker in chat (`kind: 'role_picker'`, #4958): a card an
 * officer posts listing some Non-chapter business roles, with a Join or Leave
 * button beside each for every member (`spec/behavior/rbac.md`
 * § Self-assignable roles).
 *
 * The card stores no taps: each one is the member's own `POST
 * /v1/roles/:id/join` or `/leave`, which re-checks the role. So this only
 * keeps the card readable. Who may post one and whether each role is marked
 * are checked where the roles can be read, in `ChatController.sendMessage`.
 */

export interface RolePickerCard {
  title: string;
  role_ids: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The card as it is stored, or the reason it can't be. The title is trimmed
 * (an empty one becomes {@link ROLE_PICKER_DEFAULT_TITLE}), ids are
 * lower-cased and de-duplicated, and any other key is left out.
 */
export function normalizeRolePickerCard(
  payload: unknown,
): { card: RolePickerCard } | { error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'A role picker needs at least one role' };
  }
  const raw = payload as Record<string, unknown>;

  if (raw.title != null && typeof raw.title !== 'string') {
    return { error: 'A role picker’s title must be text' };
  }
  const title =
    (typeof raw.title === 'string' ? raw.title.trim() : '') ||
    ROLE_PICKER_DEFAULT_TITLE;
  if (title.length > ROLE_PICKER_TITLE_MAX_LENGTH) {
    return {
      error: `A role picker’s title can be at most ${ROLE_PICKER_TITLE_MAX_LENGTH} characters`,
    };
  }

  if (!Array.isArray(raw.role_ids) || raw.role_ids.length === 0) {
    return { error: 'A role picker needs at least one role' };
  }
  const roleIds: string[] = [];
  for (const id of raw.role_ids) {
    if (typeof id !== 'string' || !UUID.test(id)) {
      return { error: 'A role picker lists roles by id' };
    }
    const key = id.toLowerCase();
    if (!roleIds.includes(key)) roleIds.push(key);
  }
  if (roleIds.length > ROLE_PICKER_ROLES_MAX) {
    return {
      error: `A role picker can list at most ${ROLE_PICKER_ROLES_MAX} roles`,
    };
  }
  return { card: { title, role_ids: roleIds } };
}
