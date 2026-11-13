/**
 * The empty, error and fold lines the Events and Directory screens say, one
 * string each for web and the phone (#4135, `principles.md` P6.5). A line a
 * platform says differently on purpose is not here: the phone's "Tap + to add
 * the first event." names its tab bar's +, which web doesn't have.
 */

export const EVENTS_COPY = {
  /** No upcoming event at all. Not "No events yet": the past may hold some. */
  empty: "Nothing scheduled yet.",
  /** Upcoming holds the next two weeks (#3707); the rest waits behind Later. */
  noneSoon: "Nothing in the next two weeks.",
  /** The fold's label for what starts past the two-week horizon. */
  later: "Later",
  /** The screen is Events on both apps, so the error says events. */
  loadError: "Couldn't load events",
} as const;

/** `"1 event"`, `"4 events"`: a count beside a section label or the Later fold. */
export function eventsCount(count: number): string {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

export const DIRECTORY_COPY = {
  activesEmpty: "No actives yet.",
  activesNoFilterMatches: "No actives match these filters.",
  /** The page is Directory on both apps. */
  loadError: "Couldn't load the directory",
} as const;

/**
 * A directory search that matched nobody. "Nobody", not "No actives": the
 * search covers alumni too.
 */
export function directoryNoSearchMatches(query: string): string {
  return `Nobody matches “${query}”.`;
}
