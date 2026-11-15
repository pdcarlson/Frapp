/**
 * People and channels named in an Ask answer (#4904, epic #4898).
 *
 * The agent's answer carries plain `@Display Name` and `#channel-name` in its
 * text, and beside the text a list of the names that are real: who or what
 * each one is, by id. A client draws a name as a mention only when it is in
 * that list, so a name the model made up, or a member it was never handed,
 * stays ordinary text. Paul, 2026-11-13: "if it's gonna tag users or channels
 * in the response, it should use the @ or # for that channel and highlight
 * them like discord".
 *
 * Web and the phone both cut an answer's text with `askEntityParts`, so the
 * same words are highlighted on both.
 */
import type { AskEntity } from "./ask";

/** A run of answer text: plain, or one named member or channel. */
export type AskEntityPart =
  | { type: "text"; text: string }
  | { type: "member" | "channel"; id: string; name: string; text: string };

/** `@` leads a member's name and `#` a channel's. */
const SIGIL: Record<AskEntity["type"], string> = {
  member: "@",
  channel: "#",
};

/**
 * The entities an answer came with, or none. An answer from a server that
 * predates the agent build has no list, and reads as it always did.
 *
 * Each entry is the wire's `AskEntity` (`ask.ts`). The list is read off the
 * object and checked entry by entry, not trusted from the type: anything that
 * is not a well-formed entry is dropped, an empty id or a blank name among
 * them, so a client never draws a mention from a shape it does not know.
 */
export function askAnswerEntities(answer: unknown): AskEntity[] {
  const list = (answer as { entities?: unknown } | null)?.entities;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is AskEntity =>
      typeof entry === "object" &&
      entry !== null &&
      (entry.type === "member" || entry.type === "channel") &&
      typeof entry.id === "string" &&
      entry.id.length > 0 &&
      typeof entry.name === "string" &&
      entry.name.trim().length > 0,
  );
}

/** A letter, a digit or an underscore: what a name may not run straight into. */
const WORD = /[\p{L}\p{N}_]/u;

/**
 * Cuts a run of answer text at the names in `entities`.
 *
 * - **Longest name first.** With "Sam" and "Sam Abernathy" both listed,
 *   `@Sam Abernathy` is one mention of the second, never `@Sam` and a
 *   leftover surname.
 * - **A name must stand alone.** The sigil cannot follow a letter or digit
 *   (`paul@Sam` is an address, not a mention) and the name cannot run into
 *   one (`@Samuel` is not `@Sam`), nor into a hyphen that joins more of a
 *   name (`#rush-week` is not `#rush`).
 * - **Exact spelling and case.** The server wrote the name into the text, so
 *   anything that differs is not that name.
 *
 * Text with no listed name comes back as one plain part.
 */
export function askEntityParts(
  text: string,
  entities: readonly AskEntity[],
): AskEntityPart[] {
  if (text.length === 0) return [];
  const known = entities
    .map((entity) => ({ entity, token: SIGIL[entity.type] + entity.name }))
    .sort((a, b) => b.token.length - a.token.length);
  if (known.length === 0) return [{ type: "text", text }];

  const parts: AskEntityPart[] = [];
  let plainFrom = 0;
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    const before = at > 0 ? text[at - 1] : "";
    const hit =
      (char === "@" || char === "#") && !WORD.test(before ?? "")
        ? known.find(({ token }) => {
            if (!text.startsWith(token, at)) return false;
            const end = at + token.length;
            const after = text[end] ?? "";
            if (WORD.test(after)) return false;
            // A hyphen joins a longer name: `#rush-week` is not `#rush`.
            return !(after === "-" && WORD.test(text[end + 1] ?? ""));
          })
        : undefined;
    if (!hit) {
      at += 1;
      continue;
    }
    if (at > plainFrom) {
      parts.push({ type: "text", text: text.slice(plainFrom, at) });
    }
    parts.push({
      type: hit.entity.type,
      id: hit.entity.id,
      name: hit.entity.name,
      text: hit.token,
    });
    at += hit.token.length;
    plainFrom = at;
  }
  if (plainFrom < text.length) {
    parts.push({ type: "text", text: text.slice(plainFrom) });
  }
  return parts;
}
