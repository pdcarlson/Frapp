export const stateMicrocopy = {
  members: {
    loading: "Loading chapter members...",
    emptyTitle: "No members match this view",
    emptyDescription:
      "Try a broader search or invite your first members to populate this directory.",
    previewTitle: "Showing preview member data",
    previewDescription: "Sign in to load live chapter member records.",
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
    emptyTransactionsTitle: "No transactions in this window",
    emptyTransactionsDescription:
      "Your attendance, study sessions, and adjustments will appear here.",
    previewTitle: "Showing preview points data",
    previewDescription:
      "Sign in to load live leaderboard and transaction records.",
  },
  billing: {
    loading: "Loading billing overview...",
    emptyTitle: "No invoices yet",
    emptyDescription: "Create your first invoice to start chapter dues collection.",
    previewTitle: "Showing preview billing data",
    previewDescription:
      "Sign in to load live chapter subscription and invoice records.",
  },
} as const;
