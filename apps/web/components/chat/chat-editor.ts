import { useEffect, useRef, type MutableRefObject } from "react";
import type { JSONContent } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import { Extension, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { useChapterRoster, useMentionRoles } from "@repo/hooks";
import {
  findMentionSpans,
  mentionPicksIn,
  type MentionChipTest,
  type MentionPick,
} from "@repo/validation";
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
 * StarterKit cut down to what a message body is: plain text with line breaks.
 * What an editor sends is `getText`, which keeps no structure and no marks, so
 * anything StarterKit would turn typing into was dropped before it reached the
 * wire: `- ` became a list and lost its dash, `**urgent**` became bold and
 * lost its stars, `` `npm ci` `` lost its backticks. With them off, what a
 * member types is what is sent, the way a plain textarea did it.
 */
export function chatTextKit() {
  return StarterKit.configure({
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    blockquote: false,
    codeBlock: false,
    horizontalRule: false,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    underline: false,
    link: false,
  });
}

/**
 * Pasted plain text as one run of text and hard breaks, the shape
 * `buildEditDoc` builds. ProseMirror's own parser makes a paragraph per line
 * (and folds blank lines away), and `getText` joins paragraphs with a blank
 * line, so a pasted two-line note came back with a line that was never there.
 */
export function pasteAsLines(text: string, view: EditorView): Slice {
  const { schema } = view.state;
  const inline = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line, index) => [
      ...(index > 0 ? [schema.nodes.hardBreak!.create()] : []),
      ...(line.length > 0 ? [schema.text(line)] : []),
    ]);
  return new Slice(
    Fragment.from(schema.nodes.paragraph!.create(null, inline)),
    1,
    1,
  );
}

/**
 * The text an editor sends. A paragraph boundary counts as one line break, the
 * same as a hard break: the only paragraphs these editors hold come from
 * pasted HTML, and `getText`'s default blank line between them would add a
 * line the member never saw.
 */
export function chatText(editor: Pick<Editor, "getText">): string {
  return editor.getText({ blockSeparator: "\n" });
}

/**
 * The `@` extension: the timeline's own chip (`chip.ts`), not a second
 * recipe, and the shared member-then-role list. The suggestion reads the refs
 * only from keystroke callbacks, never during render.
 */
export function chatMentionExtension(
  rosterRef: MutableRefObject<MentionRosterEntry[]>,
  rolesRef: MutableRefObject<MentionRoleEntry[]>,
  options: { onlyOnceTyped?: boolean } = {},
) {
  const suggestion = createMentionSuggestion(rosterRef, rolesRef);
  if (options.onlyOnceTyped) {
    // An edit opens with the caret at the end of the message, so one that
    // ends in an `@token` the row left as text ("hey @shawn") would pop the
    // list over the message before a key was pressed, and Enter would pick a
    // name instead of saving. The list waits for the member's first change to
    // the text; loading the message, or a newer copy of it, isn't one
    // (`preventUpdate`). Discord's edit box behaves the same, and so does
    // mobile's (`chat-composer.tsx`).
    let typed = false;
    suggestion.shouldShow = ({ transaction }) => {
      if (
        !typed &&
        transaction.docChanged &&
        !transaction.getMeta("preventUpdate")
      ) {
        typed = true;
      }
      return typed;
    };
  }
  return PickedMention.configure({
    HTMLAttributes: { class: MENTION_CHIP },
    suggestion,
  });
}

/**
 * The mention node, plus the picked member's id (#3835). A pick from the `@`
 * list spreads its row onto the node's attributes, so a member row's
 * `memberId` lands here and a role row's `null` does; a chip loaded for an
 * edit (`buildEditDoc`) carries none. Kept in the DOM as `data-member-id` so
 * copying a chip within the editor keeps it.
 */
const PickedMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      memberId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-member-id"),
        renderHTML: (attributes: { memberId?: string | null }) =>
          attributes.memberId ? { "data-member-id": attributes.memberId } : {},
      },
    };
  },
});

/**
 * The picks of each channel's unsent draft, for this tab (#3835). The draft
 * itself is saved as text (`useChannelDraft`), so a composer rebuilt from it,
 * after a channel switch remounts it, has chips with no member ids. These are
 * the ids it had. Gone on a reload, when the draft sends as names.
 */
const draftPicks = new Map<string, MentionPick[]>();

/**
 * The picks a composer's text writes: those on its own chips first, then the
 * ones its channel's draft held before it was rebuilt from text. Remembered
 * for the channel, so a remount finds them.
 */
export function composerMentionPicks(
  channelId: string,
  editor: Pick<Editor, "getText"> & Partial<Pick<Editor, "state">>,
): MentionPick[] {
  const picks = mentionPicksIn(chatText(editor), [
    ...editorMentionPicks(editor),
    ...(draftPicks.get(channelId) ?? []),
  ]);
  if (picks.length > 0) draftPicks.set(channelId, picks);
  else draftPicks.delete(channelId);
  return picks;
}

/**
 * The members picked into the editor's text (#3835): each mention node that
 * carries a member's id, as the send's `mention_picks`, keeping only those
 * the text still writes. The body stays `@Name`; the id beside it is what
 * stops a stale name from reaching a different member.
 */
export function editorMentionPicks(
  editor: Pick<Editor, "getText"> & Partial<Pick<Editor, "state">>,
): MentionPick[] {
  const picks: MentionPick[] = [];
  editor.state?.doc.descendants((node) => {
    if (node.type.name !== "mention") return;
    const memberId: unknown = node.attrs.memberId;
    const label: unknown = node.attrs.label;
    if (typeof memberId === "string" && memberId && typeof label === "string") {
      picks.push({ user_id: memberId, label });
    }
  });
  return mentionPicksIn(chatText(editor), picks);
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
    const spans = chips ? findMentionSpans(line, { names, accept: chips }) : [];
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
      content.length > 0
        ? { type: "paragraph", content }
        : { type: "paragraph" },
    ],
  };
}
