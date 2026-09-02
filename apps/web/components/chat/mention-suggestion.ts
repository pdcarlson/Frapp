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
 * The mention node's serialized text label: `display_name` with every
 * character that isn't a Unicode letter, digit, or mark removed.
 *
 * Mentions resolve **server-side**, from plain `@token` text parsed out of
 * the message body (`packages/validation/src/mentions.ts` —
 * `resolveMentions`/`extractMentionTokens`), never from a client-supplied id.
 *
 * Stripping *only* whitespace is not enough, and was a real bug caught in
 * review: the tokenizer's `MENTION_TOKEN` pattern allows a narrow set of
 * mid-token punctuation (`'’.-_`) but **truncates the match** at the first
 * character outside it — it does not reject the token, it silently shortens
 * it. A display name like "Sam (VP)" would strip to the label `Sam(VP)`;
 * `@Sam(VP)` tokenizes as just `Sam`, and if another member is exactly named
 * "Sam", the resolver's tier-2 exact-name match resolves to *that* member
 * instead — a message that looks like it mentions "Sam (VP)" silently
 * mentions the wrong person.
 *
 * Stripping to alphanumerics-and-marks only avoids this class of bug
 * entirely: every character kept is one `MENTION_TOKEN` always accepts
 * through to the end (never truncates on), so the result token-round-trips
 * intact. It also matches `mentions.ts`'s own `fold()` transform (same
 * character class, case aside), so it resolves via the resolver's "name
 * without spaces" tier the way this popup is built to guarantee — the exact
 * member picked is the exact member that resolves, not a same-named
 * lookalike or a truncated fragment (mirrored by `Mention`'s default
 * `renderText`, which serializes `@` + this label — see `composer.tsx`).
 *
 * This does not, and cannot, prevent the resolver's own accepted ambiguity
 * case — two members whose names fold to the identical string — which
 * `spec/behavior/chat/README.md`'s §Mentions already documents as failing
 * closed (nobody mentioned, not the wrong person).
 */
export function mentionLabelFor(displayName: string): string {
  return displayName.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
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
