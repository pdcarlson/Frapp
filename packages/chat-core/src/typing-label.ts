/**
 * The typing line's words, for a channel and for a message thread (#3785)
 * alike, on web and mobile: `Paul is typing…`, `Paul and Shawn are typing…`,
 * `Paul, Shawn and Alex are typing…`, then `Several people are typing…` for
 * four or more. `null` when nobody is.
 *
 * Who may be named is the caller's filter (`visibleTypingUsers` in
 * `./blocks`: never the viewer, never a member the viewer blocked); this only
 * words it. A typist whose name isn't known yet reads as `Someone`.
 */
export function typingLabel(
  typistIds: readonly string[],
  nameOf: (userId: string) => string | null | undefined,
): string | null {
  const names = typistIds.map((id) => nameOf(id)?.trim() || "Someone");
  const [first, second, third] = names;
  if (first === undefined) return null;
  if (names.length === 1) return `${first} is typing…`;
  if (names.length === 2) return `${first} and ${second} are typing…`;
  if (names.length === 3) return `${first}, ${second} and ${third} are typing…`;
  return "Several people are typing…";
}
