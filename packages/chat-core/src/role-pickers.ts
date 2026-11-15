import {
  ROLE_PICKER_DEFAULT_TITLE,
  ROLE_PICKER_ROLES_MAX,
  ROLE_PICKER_TITLE_MAX_LENGTH,
} from "@repo/validation";
import type { ChatMessage } from "./types";

/**
 * Role pickers in chat (`kind: "role_picker"`, #4958), shared by web's
 * `apps/web/components/chat/renderers/role-picker-card.tsx` and form, and the
 * phone's `apps/mobile/components/chat/role-picker-card.tsx` and sheet.
 *
 * An officer who manages roles posts a card listing some Non-chapter business
 * roles (`spec/behavior/rbac.md` § Self-assignable roles); each member taps
 * Join or Leave beside a role, as Discord's reaction-role bots (Carl-bot's
 * button roles) and Slack's interactive messages hand out interest roles.
 * A tap is the same `POST /v1/roles/:id/join` or `/leave` the Add roles
 * picker uses, so the card stores nothing per member: each viewer's buttons
 * read their own roles.
 */

export {
  ROLE_PICKER_DEFAULT_TITLE,
  ROLE_PICKER_ROLES_MAX,
  ROLE_PICKER_TITLE_MAX_LENGTH,
};

export interface RolePickerPayload {
  title: string;
  /** The roles the card lists, in the order the officer picked them. */
  role_ids: string[];
}

/** The message a picker posts: its title as `content`, so previews read it. */
export function buildRolePickerMessage(input: {
  title: string;
  roleIds: readonly string[];
}): { content: string; payload: RolePickerPayload } {
  const title = input.title.trim() || ROLE_PICKER_DEFAULT_TITLE;
  return {
    content: title,
    payload: { title, role_ids: [...new Set(input.roleIds)] },
  };
}

/** The card's payload, or `null` when it can't be read (then it draws as text). */
export function readRolePickerPayload(
  message: Pick<ChatMessage, "payload">,
): RolePickerPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const { title, role_ids: roleIds } = raw as Record<string, unknown>;
  if (typeof title !== "string" || !Array.isArray(roleIds)) return null;
  const ids = roleIds.filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return null;
  return { title, role_ids: ids };
}

/** A role the viewer can tap on the card, as `usePickableRoles` lists them. */
export interface RolePickerRoleState {
  id: string;
  name: string;
  held: boolean;
  joinable: boolean;
}

/**
 * One row of the card for this viewer:
 *
 * - `join`: a role they may join and don't hold;
 * - `leave`: a role they hold and may leave;
 * - `closed`: a role still in the chapter they can't join now (an officer
 *   unmarked it, or the viewer is an alum), drawn without a button.
 *
 * A role deleted since the card was posted is left out.
 */
export type RolePickerRow = {
  id: string;
  name: string;
  action: "join" | "leave" | "closed";
};

export function rolePickerRows(
  payload: RolePickerPayload,
  pickable: readonly RolePickerRoleState[],
  chapterRoles: readonly { id: string; name: string }[],
): RolePickerRow[] {
  const byId = new Map(pickable.map((role) => [role.id.toLowerCase(), role]));
  const names = new Map(
    chapterRoles.map((role) => [role.id.toLowerCase(), role.name]),
  );
  return payload.role_ids.flatMap((id): RolePickerRow[] => {
    const key = id.toLowerCase();
    const role = byId.get(key);
    if (role) {
      if (role.held) return [{ id: role.id, name: role.name, action: "leave" }];
      if (role.joinable)
        return [{ id: role.id, name: role.name, action: "join" }];
    }
    const name = names.get(key);
    return name === undefined ? [] : [{ id, name, action: "closed" }];
  });
}
