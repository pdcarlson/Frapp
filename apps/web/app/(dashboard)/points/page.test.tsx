import { render, screen, fireEvent } from "@testing-library/react";
import { chapterSubscription } from "@/tests/chapter-subscription";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Query state is swapped per test through these holders. `refetch` is shared so
// tests can assert the ErrorState retry actually re-runs both reads.
const leaderboardRefetch = vi.fn();
const summaryRefetch = vi.fn();

type QueryState = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

const leaderboardQuery: QueryState = {
  data: [],
  isLoading: false,
  isError: false,
  refetch: leaderboardRefetch,
};
const summaryQuery: QueryState = {
  data: { balance: 0, transactions: [] },
  isLoading: false,
  isError: false,
  refetch: summaryRefetch,
};

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

/**
 * The roster projection behind the leaderboard's User column (#1197).
 *
 * Mocked at `useMemberDisplayNames`' real contract boundary — `nameFor` returns
 * a name or `null` — rather than by restating the resolution rule. Whether a
 * blank `display_name` or a missing id becomes `null` belongs to
 * `resolveDisplayName`, which `packages/hooks/src/display-names.spec.ts`
 * already covers; what the page owes is correct handling of the `null`.
 */
const rosterRefetch = vi.fn();

const rosterState: {
  names: Record<string, string | null>;
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
} = { names: {}, isPending: false, isLoading: false, isError: false };

vi.mock("@repo/hooks", () => ({
  // Paid-ops writes on this surface now read the chapter subscription (#841);
  // these cases predate the gate, so they run against an active chapter.
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:view"] },
    isPending: false,
    isError: false,
  }),
  useLeaderboard: () => leaderboardQuery,
  useMyPoints: () => summaryQuery,
  useMemberDisplayNames: () => ({
    byId: rosterState.names,
    // Mirrors `resolveDisplayName` rather than `?? null`: `display_name` is
    // `NOT NULL DEFAULT ''`, so the real resolver maps a blank name to null. A
    // `??` mock would pass '' through and let a blank-cell regression pass here.
    nameFor: (userId: string) => {
      const name = rosterState.names[userId];
      if (typeof name !== "string") return null;
      const trimmed = name.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    isPending: rosterState.isPending,
    isLoading: rosterState.isLoading,
    isError: rosterState.isError,
    refetch: rosterRefetch,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));


vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const networkState = { isOffline: false };
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => networkState,
}));

// Both children own independent queries and error handling; stub them so these
// tests only exercise the page's own leaderboard/ledger states.
vi.mock("@/components/points/points-audit-card", () => ({
  PointsAuditCard: () => <div data-testid="points-audit-card" />,
}));
vi.mock("@/components/points/points-adjustment-dialog", () => ({
  PointsAdjustmentDialog: () => <div data-testid="points-adjustment-dialog" />,
}));

import PointsPage from "./page";

function setQueries(overrides: {
  leaderboard?: Partial<QueryState>;
  summary?: Partial<QueryState>;
  offline?: boolean;
  roster?: Partial<typeof rosterState>;
}) {
  Object.assign(leaderboardQuery, {
    data: [],
    isLoading: false,
    isError: false,
    ...overrides.leaderboard,
  });
  Object.assign(summaryQuery, {
    data: { balance: 0, transactions: [] },
    isLoading: false,
    isError: false,
    ...overrides.summary,
  });
  networkState.isOffline = overrides.offline ?? false;
  Object.assign(rosterState, {
    names: {},
    isPending: false,
    isLoading: false,
    isError: false,
    ...overrides.roster,
  });
}

// The preview rows this page used to fabricate on error (FRA-235). None of
// these strings may appear again once a read fails.
function expectNoFabricatedData() {
  expect(screen.queryByText(/preview-user-/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Preview balance/)).not.toBeInTheDocument();
  expect(screen.queryByText(/186 points/)).not.toBeInTheDocument();
  expect(screen.queryByText("Chapter Meeting check-in")).not.toBeInTheDocument();
  expect(screen.queryByText("Library geofence session")).not.toBeInTheDocument();
  expect(screen.queryByText("Late arrival adjustment")).not.toBeInTheDocument();
}

const chapter = chapterSubscription(mockCurrentChapter);

beforeEach(() => {
  vi.clearAllMocks();
  setQueries({});
  chapter.active();
});

describe("PointsPage failure states", () => {
  it("shows an error state instead of fabricated rows when the leaderboard read fails", () => {
    setQueries({ leaderboard: { isError: true } });

    render(<PointsPage />);

    expect(screen.getByText("Couldn't load the points ledger")).toBeInTheDocument();
    expectNoFabricatedData();
  });

  it("shows the error state when only the balance read fails", () => {
    setQueries({ summary: { isError: true, data: undefined } });

    render(<PointsPage />);

    expect(screen.getByText("Couldn't load the points ledger")).toBeInTheDocument();
    expectNoFabricatedData();
  });

  it("keeps adjust and bulk-export controls out of reach while data is unavailable", () => {
    setQueries({ leaderboard: { isError: true } });

    render(<PointsPage />);

    expect(screen.queryByRole("button", { name: /Adjust points/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Export selected/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Flag for audit/ })).not.toBeInTheDocument();
  });

  it("retries both reads from the error state", () => {
    setQueries({ leaderboard: { isError: true } });

    render(<PointsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(leaderboardRefetch).toHaveBeenCalledTimes(1);
    expect(summaryRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows the offline state without fabricated rows", () => {
    setQueries({ offline: true, leaderboard: { isError: true } });

    render(<PointsPage />);

    expect(screen.getByText("Points ledger unavailable offline")).toBeInTheDocument();
    expectNoFabricatedData();
  });

  it("shows the loading state while a read is in flight", () => {
    setQueries({ leaderboard: { isLoading: true } });

    render(<PointsPage />);

    expect(screen.getByText("Loading points ledger...")).toBeInTheDocument();
    expectNoFabricatedData();
  });
});

describe("PointsPage success state", () => {
  it("renders live leaderboard and transaction rows", () => {
    setQueries({
      leaderboard: { data: [{ user_id: "user-a", total: 42 }] },
      summary: {
        data: {
          balance: 42,
          transactions: [
            {
              id: "txn-1",
              amount: 12,
              category: "ATTENDANCE",
              description: "Founders Day check-in",
              created_at: "2026-08-01T12:00:00Z",
            },
          ],
        },
      },
    });

    render(<PointsPage />);

    // No roster in this fixture, so the row degrades to the shared Member label.
    expect(screen.getByText("Member user-a")).toBeInTheDocument();
    // The leaderboard total and the balance are both 42; match each by the
    // element that owns it so a future shared value can't make these ambiguous.
    expect(screen.getByRole("cell", { name: "42" })).toBeInTheDocument();
    expect(screen.getByText("My balance")).toBeInTheDocument();
    expect(screen.getByText("42 points")).toBeInTheDocument();
    expect(screen.getByText("Founders Day check-in")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the points ledger")).not.toBeInTheDocument();
  });

  it("renders empty states when the chapter has no point activity yet", () => {
    setQueries({});

    render(<PointsPage />);

    expect(screen.getByText("No leaderboard entries")).toBeInTheDocument();
    expect(screen.getByText("No transactions in this window")).toBeInTheDocument();
    expectNoFabricatedData();
  });
});


describe("PointsPage leaderboard naming (#1197)", () => {
  const ALICE = "8f14e45f-ceea-467a-9f1c-1a2b3c4d5e6f";
  const BOB = "c9f0f895-fb98-4b41-9b8e-7d2a1c0b3e4d";
  const CAROL = "45c48cce-2e2d-4fbd-aa1c-9d3f8e7b6a50";

  function withLeaderboard(
    rows: { user_id: string; total: number }[],
    names: Record<string, string | null>,
  ) {
    setQueries({ leaderboard: { data: rows }, roster: { names } });
  }

  const userCell = (text: string) => screen.getByRole("cell", { name: text });
  const search = () => screen.getByPlaceholderText("Search by member name");

  const BOARD = [
    { user_id: ALICE, total: 42 },
    { user_id: BOB, total: 17 },
    { user_id: CAROL, total: 9 },
  ];
  const NAMED = {
    [ALICE]: "Alice Chen",
    [BOB]: "Bob Ruiz",
    [CAROL]: "Carol Diaz",
  };

  it("names each member instead of showing a raw uuid", () => {
    withLeaderboard(BOARD, NAMED);

    render(<PointsPage />);

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("Bob Ruiz")).toBeInTheDocument();
    // The whole point of the issue: no uuid reaches the surface.
    expect(screen.queryByText(ALICE)).not.toBeInTheDocument();
    expect(screen.queryByText(BOB)).not.toBeInTheDocument();
  });

  it("degrades an unresolvable member to the app's shared Member label", () => {
    // They are off the roster but keep their points, so the row must still
    // render — and it renders the same `Member <6 hex>` label `resolveAuthorLabel`,
    // the task board and the member directory use, so one departed member reads
    // identically wherever they appear.
    withLeaderboard(BOARD, { [ALICE]: "Alice Chen" });

    render(<PointsPage />);

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(userCell("Member c9f0f8")).toBeInTheDocument();
    expect(screen.queryByText(BOB)).not.toBeInTheDocument();
  });

  it("treats a member who never set a name as unresolved, not as a blank cell", () => {
    // `display_name` is `NOT NULL DEFAULT ''`, so this is the real "no name set"
    // case rather than a missing row, and a blank cell would read as broken.
    withLeaderboard([{ user_id: ALICE, total: 42 }], { [ALICE]: "   " });

    render(<PointsPage />);

    expect(userCell("Member 8f14e4")).toBeInTheDocument();
  });

  it("keeps rank and total on mono tabular numerals, and the name off mono", () => {
    // #920's Directory & Finance slice added the numeral treatment and it must
    // survive; foundations §7 reserves mono for ids, tokens, keys and points
    // cells, and this cell now holds a person.
    withLeaderboard([{ user_id: ALICE, total: 42 }], { [ALICE]: "Alice Chen" });

    render(<PointsPage />);

    expect(userCell("#1")).toHaveClass("font-mono", "tabular-nums");
    expect(userCell("42")).toHaveClass("font-mono", "tabular-nums");
    expect(userCell("Alice Chen")).not.toHaveClass("font-mono");
  });

  it("searches by name", () => {
    withLeaderboard(BOARD, NAMED);

    render(<PointsPage />);
    fireEvent.change(search(), { target: { value: "alice" } });

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText("Bob Ruiz")).not.toBeInTheDocument();
  });

  it("reports the board rank, not the position within a filtered view", () => {
    // Naming the rows made filtering an everyday action, so a rank renumbered
    // from #1 per search would misreport chapter standing.
    withLeaderboard(BOARD, NAMED);

    render(<PointsPage />);
    fireEvent.change(search(), { target: { value: "carol" } });

    expect(screen.getByText("Carol Diaz")).toBeInTheDocument();
    expect(userCell("#3")).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "#1" })).not.toBeInTheDocument();
  });

  it("still finds a named member by a pasted user id", () => {
    // Officers paste ids out of audit rows and support tickets, and that was the
    // only thing this box matched before names existed.
    withLeaderboard(BOARD, NAMED);

    render(<PointsPage />);
    fireEvent.change(search(), { target: { value: BOB } });

    expect(screen.getByText("Bob Ruiz")).toBeInTheDocument();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
  });

  it("says a search matched nothing rather than claiming the chapter has no activity", () => {
    withLeaderboard(BOARD, NAMED);

    render(<PointsPage />);
    fireEvent.change(search(), { target: { value: "nobody" } });

    expect(screen.getByText("No members match that search")).toBeInTheDocument();
    expect(screen.queryByText("No leaderboard entries")).not.toBeInTheDocument();
  });

  it("keeps the empty-board copy when the board really is empty", () => {
    withLeaderboard([], {});

    render(<PointsPage />);

    expect(screen.getByText("No leaderboard entries")).toBeInTheDocument();
    expect(
      screen.queryByText("No members match that search"),
    ).not.toBeInTheDocument();
  });

  it("waits for names inside the leaderboard card without withholding the page", () => {
    // The roster feeds one column. Gating the whole page on it would hold the
    // balance, the ledger and the adjust control hostage to a third query — and
    // with retry backoff, for seconds before painting the ids it was avoiding.
    setQueries({
      leaderboard: { data: BOARD },
      summary: { data: { balance: 42, transactions: [] } },
      roster: { isPending: true, isLoading: true },
    });

    render(<PointsPage />);

    expect(screen.getByText("Loading member names...")).toBeInTheDocument();
    expect(screen.queryByText("Loading points ledger...")).not.toBeInTheDocument();
    expect(screen.getByText("42 points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Adjust points/ })).toBeEnabled();
    expect(screen.queryByText(ALICE)).not.toBeInTheDocument();
  });

  it("renders the board with no active chapter, where the roster query is disabled", () => {
    // A disabled query is `isPending` but not `isLoading`. Gating on the former
    // would pin this route to a loading state whenever there is no chapter,
    // which is the state the sessionless 375px floor harness renders it in.
    setQueries({ leaderboard: { data: [] }, roster: { isPending: true } });

    render(<PointsPage />);

    expect(screen.queryByText("Loading points ledger...")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading member names...")).not.toBeInTheDocument();
    expect(screen.getByText("No leaderboard entries")).toBeInTheDocument();
  });

  it("keeps the board usable when the roster fails, degrading names to labels", () => {
    // Deliberately not an error card: the totals came from the leaderboard read
    // and are still accurate, so replacing a working board would be worse.
    // Surfacing the degradation to the member is #1209's job, not this page's.
    setQueries({
      leaderboard: { data: [{ user_id: ALICE, total: 42 }] },
      roster: { isError: true },
    });

    render(<PointsPage />);

    expect(screen.queryByText("Couldn't load the points ledger")).not.toBeInTheDocument();
    expect(userCell("Member 8f14e4")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "42" })).toBeInTheDocument();
  });

  it("recovers names from the page's retry controls", () => {
    // The roster raises no error card of its own, so these are the only path
    // back to names once its retries are spent.
    setQueries({ leaderboard: { isError: true } });

    render(<PointsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(rosterRefetch).toHaveBeenCalledTimes(1);
  });
});


describe("PointsPage subscription gating", () => {
  // `POST /v1/points/adjust` is paid-ops. `PointsAdjustmentDialog` gates its own
  // fields, but this page owns `open`, so §5 rule 1 — never open onto a doomed
  // form — has to be enforced at the trigger here (#841).
  const adjust = () => screen.getByRole("button", { name: /adjust points/i });

  it("disables the adjust trigger and names the blocker on a lapsed chapter", () => {
    chapter.incomplete();
    render(<PointsPage />);

    expect(adjust()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("leaves the ledger reads live while blocked", () => {
    // A lapsed chapter keeps full visibility of its own history — the window
    // filters are GETs and the guard returns early for reads.
    chapter.incomplete();
    render(<PointsPage />);

    expect(screen.getByRole("button", { name: /semester/i })).toBeEnabled();
  });

  it("leaves the adjust trigger alone on an active chapter", () => {
    chapter.active();
    render(<PointsPage />);

    expect(adjust()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    render(<PointsPage />);

    expect(adjust()).toBeEnabled();
  });
});
