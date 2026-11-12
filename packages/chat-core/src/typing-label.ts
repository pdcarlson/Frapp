/**
 * The typing line's words, for a channel and for a message thread (#3785)
 * alike, on web and mobile: `Paul is typing…`, `Paul and Shawn are typing…`,
 * `Paul, Shawn and Alex are typing…`, then `Several people are typing…` for
 * four or more. `null` when nobody is.
 *
 * Who may be named is the caller's filter (`visibleTypingUsers` in
 * `./blocks`: never the viewer, never a member the viewer blocked); this only
 * words it. A typist the roster can't name yet is left out rather than called
 * `Someone`, the anonymous line Paul asked to be rid of (2026-11-12): the chat
 * surfaces re-read the roster when they meet an id it lacks
 * (`useRosterCatchUp` in `@repo/hooks/use-members`), so a member who joined
 * after it loaded is named a moment later. Four or more typists read as
 * `Several people` whether or not each is named.
 */
export function typingLabel(
  typistIds: readonly string[],
  nameOf: (userId: string) => string | null | undefined,
): string | null {
  if (typistIds.length >= 4) return "Several people are typing…";
  const names = typistIds.flatMap((id) => {
    const name = nameOf(id)?.trim();
    return name ? [name] : [];
  });
  const [first, second, third] = names;
  if (first === undefined) return null;
  if (names.length === 1) return `${first} is typing…`;
  if (names.length === 2) return `${first} and ${second} are typing…`;
  return `${first}, ${second} and ${third} are typing…`;
}
