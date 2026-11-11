import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { memberAvatarHue, memberAvatarTint } from "@repo/hooks";
import { mentionPickerEntries } from "@repo/validation";
import {
  MentionList,
  type MentionListHandle,
  type MentionSuggestionItem,
} from "./mention-list";

/** Roster shape this module needs — a subset of `MemberRosterEntryDto`. */
export interface MentionRosterEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  /** The name's role color, which an officer's initials avatar takes (#3860). */
  role_color?: string | null;
}

/** Role shape this module needs — a subset of `MentionRoleDto`. */
export interface MentionRoleEntry {
  role_id: string;
  name: string;
  mentionable: boolean;
}

/**
 * The roster and the roles as this popup offers them. Which rows, in what
 * order, and the label each inserts are `mentionPickerEntries`'s
 * (`@repo/validation`), shared with mobile's composer so a pick on either
 * client sends the same body; `mentionPickLabel` there says when the label is
 * the name as written and when it is reduced to letters, digits and marks. Roles come after members,
 * at most three, and only the ones the viewer may ping (2026-11-06).
 */
export function filterMentionEntries(
  roster: readonly MentionRosterEntry[],
  roles: readonly MentionRoleEntry[],
  query: string,
): MentionSuggestionItem[] {
  return mentionPickerEntries(roster, roles, query).map((entry) =>
    entry.kind === "member"
      ? {
          kind: "member",
          id: entry.member.user_id,
          label: entry.label,
          displayName: entry.member.display_name,
          avatarUrl: entry.member.avatar_url,
          avatarTint: memberAvatarTint(
            memberAvatarHue(entry.member.user_id, entry.member.role_color),
          ),
        }
      : {
          kind: "role",
          id: entry.role.role_id,
          label: entry.label,
          displayName: entry.role.name,
          avatarUrl: null,
          avatarTint: null,
        },
  );
}

/**
 * Builds the `@`-mention `suggestion` config for `@tiptap/extension-mention`.
 *
 * `rosterRef` (and `rolesRef`, the same way) rather than a plain array: `useEditor`'s extensions are built
 * once at mount (neither the composer nor the inline edit field passes a deps
 * array; both build this through `chatMentionExtension` in `chat-editor.ts`), so a value closed over
 * directly here would be whatever the roster query returned on the first
 * render — `[]`, before the query has ever resolved. Reading through a ref
 * that a `useEffect` keeps current lets `items()` see the live roster on
 * every keystroke without rebuilding the editor.
 */
export function createMentionSuggestion(
  rosterRef: { current: readonly MentionRosterEntry[] },
  rolesRef: { current: readonly MentionRoleEntry[] } = { current: [] },
): Omit<SuggestionOptions<MentionSuggestionItem>, "editor"> {
  return {
    char: "@",
    // No `command` here — deliberately. `@tiptap/extension-mention`'s
    // default `command` (insert the node, add a trailing space, mind an
    // already-adjacent space) is exactly right and this object's `command`
    // key must stay *absent*, not `undefined`: the extension spreads this
    // object over its own defaults (`{ ...defaults, ...this }`), and an
    // absent key leaves the default in place while an explicit `undefined`
    // would overwrite it — silently turning "pick a mention" into a no-op.
    items: ({ query }) =>
      filterMentionEntries(rosterRef.current, rolesRef.current, query),
    render: () => {
      let component: ReactRenderer<MentionListHandle> | null = null;
      let unmount: (() => void) | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });
          unmount = props.mount(component.element);
        },
        onUpdate: (props) => {
          component?.updateProps(props);
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            unmount?.();
            unmount = null;
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          unmount?.();
          unmount = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
