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
const rosterState: {
  names: Record<string, string | null>;
  isPending: boolean;
  isError: boolean;
} = { names: {}, isPending: false, isError: false };

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
    nameFor: (userId: string) => rosterState.names[userId] ?? null,
    isPending: rosterState.isPending,
    isError: rosterState.isError,
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

    expect(screen.getByText("user-a")).toBeInTheDocument();
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

  function withLeaderboard(
    rows: { user_id: string; total: number }[],
    names: Record<string, string | null>,
  ) {
    setQueries({ leaderboard: { data: rows }, roster: { names } });
  }

  const userCell = (text: string) => screen.getByRole("cell", { name: text });

  it("names each member instead of showing a raw uuid", () => {
    withLeaderboard(
      [
        { user_id: ALICE, total: 42 },
        { user_id: BOB, total: 17 },
      ],
      { [ALICE]: "Alice Chen", [BOB]: "Bob Ruiz" },
    );

    render(<PointsPage />);

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("Bob Ruiz")).toBeInTheDocument();
    // The whole point of the issue: the uuid is gone from the surface.
    expect(screen.queryByText(ALICE)).not.toBeInTheDocument();
    expect(screen.queryByText(BOB)).not.toBeInTheDocument();
  });

  it("falls back to the raw id for a member who has left the chapter", () => {
    // They are off the roster but keep their points, so the row must still
    // render — identified by the only handle left rather than dropped.
    withLeaderboard(
      [
        { user_id: ALICE, total: 42 },
        { user_id: BOB, total: 17 },
      ],
      { [ALICE]: "Alice Chen" },
    );

    render(<PointsPage />);

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText(BOB)).toBeInTheDocument();
  });

  it("treats an unset display name as unresolved rather than rendering a blank cell", () => {
    // `display_name` is `NOT NULL DEFAULT ''`, so `nameFor` answers null and the
    // id has to win — a blank cell would read as a broken layout.
    withLeaderboard([{ user_id: ALICE, total: 42 }], { [ALICE]: null });

    render(<PointsPage />);

    expect(userCell(ALICE)).toBeInTheDocument();
  });

  it("carries mono only where the cell still holds an id", () => {
    // foundations §7 reserves mono for ids, tokens, keys and points cells. A
    // name is none of those, so the family follows the value, not the column.
    withLeaderboard(
      [
        { user_id: ALICE, total: 42 },
        { user_id: BOB, total: 17 },
      ],
      { [ALICE]: "Alice Chen" },
    );

    render(<PointsPage />);

    expect(userCell("Alice Chen")).not.toHaveClass("font-mono");
    expect(userCell(BOB)).toHaveClass("font-mono");
  });

  it("keeps rank and total on mono tabular numerals", () => {
    // #920's Directory & Finance slice added these and they must survive.
    withLeaderboard([{ user_id: ALICE, total: 42 }], { [ALICE]: "Alice Chen" });

    render(<PointsPage />);

    expect(userCell("#1")).toHaveClass("font-mono", "tabular-nums");
    expect(userCell("42")).toHaveClass("font-mono", "tabular-nums");
  });

  it("searches by name", () => {
    withLeaderboard(
      [
        { user_id: ALICE, total: 42 },
        { user_id: BOB, total: 17 },
      ],
      { [ALICE]: "Alice Chen", [BOB]: "Bob Ruiz" },
    );

    render(<PointsPage />);
    fireEvent.change(screen.getByPlaceholderText("Search by member name"), {
      target: { value: "alice" },
    });

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText("Bob Ruiz")).not.toBeInTheDocument();
  });

  it("still matches the id of a row that has no name to match", () => {
    // Search filters on whatever the row displays, so no row is unsearchable.
    withLeaderboard(
      [
        { user_id: ALICE, total: 42 },
        { user_id: BOB, total: 17 },
      ],
      { [ALICE]: "Alice Chen" },
    );

    render(<PointsPage />);
    fireEvent.change(screen.getByPlaceholderText("Search by member name"), {
      target: { value: BOB.slice(0, 8) },
    });

    expect(screen.getByText(BOB)).toBeInTheDocument();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
  });

  it("waits for the roster rather than rendering ids that then re-label", () => {
    setQueries({
      leaderboard: { data: [{ user_id: ALICE, total: 42 }] },
      roster: { isPending: true },
    });

    render(<PointsPage />);

    expect(screen.getByText("Loading points ledger...")).toBeInTheDocument();
    expect(screen.queryByText(ALICE)).not.toBeInTheDocument();
  });

  it("keeps the board usable when the roster fails, degrading names to ids", () => {
    // Deliberately NOT an error card: the totals came from the leaderboard read
    // and are still accurate, so replacing a working board would be worse.
    // Surfacing the degradation to the member is #1209's job, not this page's.
    setQueries({
      leaderboard: { data: [{ user_id: ALICE, total: 42 }] },
      roster: { isError: true },
    });

    render(<PointsPage />);

    expect(screen.queryByText("Couldn't load the points ledger")).not.toBeInTheDocument();
    expect(userCell(ALICE)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "42" })).toBeInTheDocument();
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
