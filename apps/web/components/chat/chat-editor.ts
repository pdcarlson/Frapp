import { useEffect, useRef, type MutableRefObject } from "react";
import type { JSONContent } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";
import { useChapterRoster, useMentionRoles } from "@repo/hooks";
import { findMentionSpans, type MentionChipTest } from "@repo/validation";
import { MENTION_CHIP } from "./chip";
import {
  createMentionSuggestion,
  type MentionRoleEntry,
  type MentionRosterEntry,
} from "./mention-suggestion";

/**
 * What the chat's two text editors share: the composer, and the inline editor
 * a message turns into when its author presses Edit (#2236). One recipe for
 * the `@` list and the chip it inserts, so a handle reads the same while it is
 * typed, once it is sent, and while it is edited (`components.md` §11).
 */

/**
 * The roster and roles the `@` list offers, held in refs. `useEditor` builds
 * its extensions once, so a plain closure would keep whichever roster had
 * loaded at first render (usually none); the suggestion reads the refs on
 * every keystroke instead and always sees the latest. Both reads are cached
 * queries, so an editor that mounts per message costs no request.
 */
export function useMentionSourceRefs(): {
  rosterRef: MutableRefObject<MentionRosterEntry[]>;
  rolesRef: MutableRefObject<MentionRoleEntry[]>;
} {
  const chapterRoster = useChapterRoster();
  const rosterRef = useRef<MentionRosterEntry[]>([]);
  useEffect(() => {
    rosterRef.current = chapterRoster.data ?? [];
  }, [chapterRoster.data]);
  const mentionRoles = useMentionRoles();
  const rolesRef = useRef<MentionRoleEntry[]>([]);
  useEffect(() => {
    rolesRef.current = mentionRoles.data ?? [];
  }, [mentionRoles.data]);
  return { rosterRef, rolesRef };
}

/**
 * The `@` extension: the timeline's own chip (`chip.ts`), not a second
 * recipe, and the shared member-then-role list. The suggestion reads the refs
 * only from keystroke callbacks, never during render.
 */
export function chatMentionExtension(
  rosterRef: MutableRefObject<MentionRosterEntry[]>,
  rolesRef: MutableRefObject<MentionRoleEntry[]>,
) {
  return Mention.configure({
    HTMLAttributes: { class: MENTION_CHIP },
    suggestion: createMentionSuggestion(rosterRef, rolesRef),
  });
}

/**
 * Bind `keys` to the handlers in `handlersRef` as a Tiptap extension, so a
 * key reads ProseMirror's own state (an IME composition included) instead of
 * a flaky DOM keydown, and the latest handler runs without re-binding. A
 * handler returns `true` when it took the key. The `@` list's own keys come
 * first: the Mention extension outranks this one, so Enter picks a name and
 * Escape closes the list while it is open.
 */
export function createKeymap(
  name: string,
  handlersRef: { current: Partial<Record<"Enter" | "Escape", () => void>> },
) {
  return Extension.create({
    name,
    addKeyboardShortcuts() {
      const bind = (key: "Enter" | "Escape") => () => {
        const handler = handlersRef.current[key];
        if (!handler) return false;
        handler();
        return true;
      };
      return { Enter: bind("Enter"), Escape: bind("Escape") };
    },
  });
}

/**
 * A sent message as the inline editor's document: one paragraph, each line
 * break a hard break, and each `@`-token the row paints as a chip (`chips`,
 * from `useMentionChips`) a mention node that writes itself back as the same
 * `@token`. So the body round-trips exactly: `getText` gives back the string
 * the server holds, plus whatever the member changed, and mentions stay the
 * chips they were in the row instead of dropping to raw text the moment Edit
 * is pressed (#2236).
 *
 * Hard breaks rather than a paragraph per line: `getText` joins paragraphs
 * with a blank line, so a two-line message would come back as three.
 */
export function buildEditDoc(
  text: string,
  chips?: MentionChipTest | ((token: string) => boolean),
): JSONContent {
  const content: JSONContent[] = [];
  const names = chips && "names" in chips ? chips.names : [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    let at = 0;
    const spans = chips
      ? findMentionSpans(line, { names, accept: chips })
      : [];
    for (const span of spans) {
      if (span.start > at) {
        content.push({ type: "text", text: line.slice(at, span.start) });
      }
      content.push({
        type: "mention",
        attrs: { id: span.token, label: span.token },
      });
      at = span.end;
    }
    if (at < line.length) content.push({ type: "text", text: line.slice(at) });
  });
  return {
    type: "doc",
    content: [
      content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" },
    ],
  };
}
