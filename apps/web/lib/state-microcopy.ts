import { DIRECTORY_COPY, EVENTS_COPY } from "@repo/validation";

export const stateMicrocopy = {
  // Rewritten by the greenfield Directory lane (#2146). The board's state rule
  // is "Empty = accent tile + tinted CTA. No results = neutral tile, names the
  // query", under a section eyebrow that budgets the status line at six words —
  // so the one `emptyTitle`/`emptyDescription` pair that used to answer both
  // questions ("Try a broader search or invite your first members to populate
  // this directory.") is now three, and every description is a fact rather than
  // an instruction to the reader. The split is the same one `points` below
  // already makes between an empty leaderboard and a search that matched
  // nothing, for the same reason: a filtered view that matches nothing is not a
  // claim about the roster. The `preview*` pair went with the error string that
  // named it; the surface has had no preview data since that fallback was
  // removed, and nothing read either key.
  members: {
    loading: "Loading chapter members...",
    // "Actives", not "members", on both of these lines: it is the word the tab and
    // the section label above the list already use, and it is the string the
    // shipped mobile Directory renders for the same state
    // (`apps/mobile/app/(app)/directory.tsx`). The two surfaces are meant to
    // read as one product, and this is the cheapest place to stop them drifting.
    empty: DIRECTORY_COPY.activesEmpty,
    noFilterMatches: DIRECTORY_COPY.activesNoFilterMatches,
    offlineTitle: "Members unavailable offline",
    offlineDescription: "Reconnect to load the roster.",
    // One string with the phone's (#4135): `@repo/validation` screen-copy.
    errorTitle: DIRECTORY_COPY.loadError,
    supportErrorTitle: "Couldn't load roles and points",
    supportErrorDescription: "Filtering, sorting and assignment need both.",
  },
  // Same split as `members` above: a filter or search that matches nothing is
  // not an empty chapter. The `preview*` pair had no reader left.
  events: {
    loading: "Loading chapter events...",
    // Inline lines, not card titles (`components.md` §10). A chapter with no
    // events opens on the calendar, so `empty` is what the List tab says if
    // someone switches to it; the calendar carries its own line. The phone
    // says the same line (#4135).
    empty: EVENTS_COPY.empty,
    noUpcoming: "No upcoming events.",
    noPast: "No past events.",
    // Upcoming holds the next two weeks (#3707); what's after them waits
    // behind Later, right under this line.
    noneSoon: EVENTS_COPY.noneSoon,
    noSearchMatches: "No events match that search.",
    noFilterMatches: "No events match these filters.",
    // On the calendar of a chapter with no events. Officers who can create
    // get the how; everyone else gets the fact.
    calendarFirstEvent: "Pick a day to schedule the first event.",
    // The compact month (#4022): pressing a day picks it, and New event under
    // the grid makes one on the picked day.
    calendarFirstEventCompact:
      "Pick a day, then New event to schedule the first event.",
    // The compact month's day list, for a picked day with nothing on it.
    calendarDayEmpty: "Nothing on this day.",
    calendarNothingYet: "Nothing on the calendar yet.",
    offlineTitle: "Events workspace unavailable offline",
    offlineDescription:
      "Reconnect to load event schedules and attendance updates.",
    errorTitle: EVENTS_COPY.loadError,
  },
  points: {
    loading: "Loading points ledger...",
    // Inline lines (one sentence each), not card titles: the board keeps its
    // layout at zero. The board lists the roster, so it is empty only for a
    // chapter with nobody on it, or an archived semester nobody earned in.
    // `everyoneAtZero` is for a live period only (the page doesn't draw it
    // for an archived one, which is closed).
    emptyLeaderboard: "Nobody has points in this period.",
    everyoneAtZero:
      "Everyone is tied at 0. The first points earned take the lead.",
    // A filtered board that matches nothing is not an empty board. Reusing the
    // copy above would assert something about the chapter's data rather than
    // about the search (#1197).
    noLeaderboardMatches: "No members match that search.",
    emptyTransactions: "No points in this period yet.",
    noTransactionMatches: "No transactions match these filters.",
    errorTitle: "Couldn't load the points ledger",
  },
  billing: {
    loading: "Loading billing overview...",
    empty: "No invoices yet.",
    emptyMember: "You have no invoices.",
    noMatches: "No invoices match these filters.",
  },
} as const;
