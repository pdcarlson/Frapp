import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
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

const MAX_SUGGESTIONS = 8;

/**
 * The mention node's serialized text label: `display_name` with internal
 * whitespace removed.
 *
 * Mentions resolve **server-side**, from plain `@token` text parsed out of
 * the message body (`packages/validation/src/mentions.ts` —
 * `resolveMentions`/`extractMentionTokens`), never from a client-supplied id.
 * That parser's token pattern stops at whitespace, so `@Jane Doe` would only
 * ever extract the token `Jane` — which resolves only if "Jane" is a unique
 * first name. Stripping the space instead lines up with the resolver's
 * "name without spaces" tier, so a name picked from this popup always
 * resolves to the exact member selected (mirrored by `Mention`'s default
 * `renderText`, which serializes `@` + this label — see `composer.tsx`).
 */
export function mentionLabelFor(displayName: string): string {
  return displayName.replace(/\s+/g, "");
}

/**
 * Every mention token must open on a Unicode letter
 * (`packages/validation/src/mentions.ts`'s `MENTION_TOKEN`), so a label
 * computed from a digit-led display name (e.g. "123 Squad" -> "123Squad")
 * would never be recognized as a mention at all — the server wouldn't even
 * see it as a candidate token to resolve, let alone resolve it. Per
 * `spec/behavior/chat/README.md`'s explicit note for anyone building a
 * mention affordance: "Autocomplete SHOULD NOT present a digit-led display
 * name as reachable by typing." Excluded here rather than left to silently
 * insert a mention that can never work.
 */
function opensOnLetter(label: string): boolean {
  return /^\p{L}/u.test(label);
}

function filterRoster(
  roster: readonly MentionRosterEntry[],
  query: string,
): MentionSuggestionItem[] {
  const needle = query.trim().toLowerCase();
  const candidates = roster
    .filter((member) => member.display_name.length > 0)
    .map((member) => ({
      id: member.user_id,
      label: mentionLabelFor(member.display_name),
      displayName: member.display_name,
      avatarUrl: member.avatar_url,
    }))
    .filter((item) => opensOnLetter(item.label));
  const matches = needle
    ? candidates.filter((item) =>
        item.displayName.toLowerCase().includes(needle),
      )
    : candidates;
  return matches.slice(0, MAX_SUGGESTIONS);
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
