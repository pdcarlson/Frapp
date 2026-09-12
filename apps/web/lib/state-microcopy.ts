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
    // (`apps/mobile/app/(tabs)/directory.tsx`). The two surfaces are meant to
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
    errorDescription: "Check your chapter access and API health.",
    supportErrorTitle: "Couldn't load roles and points",
    supportErrorDescription: "Filtering, sorting and assignment need both.",
  },
  events: {
    loading: "Loading chapter events...",
    emptyTitle: "No events yet",
    emptyDescription:
      "Create your first chapter event to unlock attendance and point automation.",
    previewTitle: "Showing preview event data",
    previewDescription:
      "Sign in to load live event scheduling and attendance records.",
  },
  points: {
    loading: "Loading points ledger...",
    emptyLeaderboardTitle: "No leaderboard entries",
    emptyLeaderboardDescription:
      "Point activity will populate after attendance, study, or admin adjustments.",
    // A filtered board that matches nothing is not an empty board. Reusing the
    // copy above would assert the chapter has had no point activity at all,
    // which is a claim about the data rather than about the search (#1197).
    noLeaderboardMatchesTitle: "No members match that search",
    noLeaderboardMatchesDescription:
      "Check the spelling, or clear the search to see the full leaderboard.",
    emptyTransactionsTitle: "No transactions in this window",
    emptyTransactionsDescription:
      "Your attendance, study sessions, and adjustments will appear here.",
    errorTitle: "Couldn't load the points ledger",
    errorDescription:
      "Standings and transactions are unavailable, so none are shown. Verify your chapter access and API health, then retry.",
  },
  billing: {
    loading: "Loading billing overview...",
    emptyTitle: "No invoices yet",
    emptyDescription:
      "Create your first invoice to start chapter dues collection.",
    previewTitle: "Showing preview billing data",
    previewDescription:
      "Sign in to load live chapter subscription and invoice records.",
  },
} as const;
