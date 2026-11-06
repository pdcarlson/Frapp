import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { mentionSuggestions } from "@repo/validation";
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
}

/**
 * The roster as this popup offers it. Which members, in what order, and the
 * label each inserts are `mentionSuggestions`'s (`@repo/validation`), shared
 * with mobile's composer so a member picked on either client sends the same
 * body; `mentionLabelFor` there says why the label is the display name reduced
 * to letters, digits and marks.
 */
function filterRoster(
  roster: readonly MentionRosterEntry[],
  query: string,
): MentionSuggestionItem[] {
  return mentionSuggestions(roster, query).map(({ member, label }) => ({
    id: member.user_id,
    label,
    displayName: member.display_name,
    avatarUrl: member.avatar_url,
  }));
}

/**
 * Builds the `@`-mention `suggestion` config for `@tiptap/extension-mention`.
 *
 * `rosterRef` rather than a plain array: `useEditor`'s extensions are built
 * once at mount (this composer passes no deps array), so a value closed over
 * directly here would be whatever the roster query returned on the first
 * render — `[]`, before the query has ever resolved. Reading through a ref
 * that a `useEffect` keeps current lets `items()` see the live roster on
 * every keystroke without rebuilding the editor.
 */
export function createMentionSuggestion(
  rosterRef: { current: readonly MentionRosterEntry[] },
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
    items: ({ query }) => filterRoster(rosterRef.current, query),
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
