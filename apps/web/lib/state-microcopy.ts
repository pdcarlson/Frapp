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
    // "Actives", not "members", on both of these: it is the word the tab and
    // the section label above the list already use, and it is the string the
    // shipped mobile Directory renders for the same state
    // (`apps/mobile/app/(app)/directory.tsx`). The two surfaces are meant to
    // read as one product, and this is the cheapest place to stop them drifting.
    emptyTitle: "No actives yet",
    emptyDescription: "Actives appear here once they join.",
    filteredTitle: "No actives match the filters",
    filteredDescription: "Clear a filter to see more.",
    // The title is built at the call site because it quotes the live query.
    noMatchDescription: "Check the spelling, or widen the filters.",
    offlineTitle: "Members unavailable offline",
    offlineDescription: "Reconnect to load the roster.",
    errorTitle: "Couldn't load members",
    errorDescription: "Confirm your chapter access and retry.",
    supportErrorTitle: "Couldn't load roles and points",
    supportErrorDescription: "Filtering, sorting and assignment need both.",
  },
  // Same split as `members` above: a filter or search that matches nothing is
  // not an empty chapter. The `preview*` pair had no reader left.
  events: {
    loading: "Loading chapter events...",
    // Inline lines, not card titles (`components.md` §10). A chapter with no
    // events opens on the calendar, so `empty` is what the List tab says if
    // someone switches to it; the calendar carries its own line.
    empty: "No events yet.",
    noUpcoming: "No upcoming events.",
    noPast: "No past events.",
    noSearchMatches: "No events match that search.",
    noFilterMatches: "No events match these filters.",
    // On the calendar of a chapter with no events. Officers who can create
    // get the how; everyone else gets the fact.
    calendarFirstEvent: "Pick a day to schedule the first event.",
    calendarNothingYet: "Nothing on the calendar yet.",
    offlineTitle: "Events workspace unavailable offline",
    offlineDescription:
      "Reconnect to load event schedules and attendance updates.",
    errorTitle: "Couldn't load chapter events",
    errorDescription: "Confirm your chapter access and retry.",
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
    errorDescription:
      "Standings and transactions are unavailable, so none are shown. Confirm your chapter access and retry.",
  },
  billing: {
    loading: "Loading billing overview...",
    emptyTitle: "No invoices yet",
    emptyDescription:
      "Create your first invoice to start chapter dues collection.",
  },
} as const;
