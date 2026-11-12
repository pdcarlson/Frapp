import {
  channelAccessKindHeading,
  channelAccessReach,
  compareChannelAccessKinds,
  type ChannelAccessOption,
  type ChannelAccessQuestion,
} from "@repo/hooks/channel-access";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";

/**
 * The pure half of the phone's Who can see / Who can post step
 * (`components/chat/channel-access-sheet.tsx`, #3702), here so a spec can
 * reach it without bundling a screen (`channel-list.ts` says why).
 */

export type ChannelAccessRow =
  | { kind: "heading"; key: string; label: string }
  | { kind: "option"; key: string; option: ChannelAccessOption };

export function peopleCount(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}

/** The line under the switch: what the answer means, in a sentence. */
export function channelAccessSummaryLine(
  question: ChannelAccessQuestion,
  value: readonly string[] | null,
  options: readonly ChannelAccessOption[],
  optionsReady: boolean,
): string {
  const verb = question === "see" ? "see it" : "post";
  if (value === null) {
    return question === "see"
      ? "Everyone in the chapter can see it."
      : "Everyone who can see it can post.";
  }
  if (value.length === 0) {
    return `Pick a tier or role. Until you do, only the President can ${verb}.`;
  }
  return optionsReady
    ? `Reaches ${peopleCount(channelAccessReach(value, options))}. The President can always ${verb}.`
    : `The President can always ${verb}.`;
}

/**
 * The rows a visit shows: tiers, then roles, each under its heading, with the
 * entries already on the list when the sheet opened leading their group (so
 * an officer at a chapter with a hundred roles sees what's chosen without
 * scrolling), narrowed by the search. A hidden role (Everyone, #4191) shows
 * only while the list names it, so it can be taken off.
 */
export function channelAccessRows(
  options: readonly ChannelAccessOption[],
  pinned: ReadonlySet<string>,
  query: string,
): ChannelAccessRow[] {
  const searching = normalizeWords(query).length > 0;
  const shown = options.filter(
    (option) =>
      (!option.hidden || pinned.has(option.entry)) &&
      (!searching || matchesWordStarts(option.name, query)),
  );
  const kinds = [...new Set(shown.map((option) => option.kind))].sort(
    compareChannelAccessKinds,
  );
  return kinds.flatMap((kind): ChannelAccessRow[] => {
    const ofKind = shown.filter((option) => option.kind === kind);
    const ordered = [
      ...ofKind.filter((option) => pinned.has(option.entry)),
      ...ofKind.filter((option) => !pinned.has(option.entry)),
    ];
    return [
      {
        kind: "heading",
        key: `heading:${kind}`,
        label: channelAccessKindHeading(kind),
      },
      ...ordered.map((option): ChannelAccessRow => ({
        kind: "option",
        key: option.entry,
        option,
      })),
    ];
  });
}
