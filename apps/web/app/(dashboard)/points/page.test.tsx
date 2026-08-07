import { render, screen, fireEvent } from "@testing-library/react";
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

vi.mock("@repo/hooks", () => ({
  useLeaderboard: () => leaderboardQuery,
  useMyPoints: () => summaryQuery,
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
vi.mock("@/components/points-adjustment-dialog", () => ({
  PointsAdjustmentDialog: () => <div data-testid="points-adjustment-dialog" />,
}));

import PointsPage from "./page";

function setQueries(overrides: {
  leaderboard?: Partial<QueryState>;
  summary?: Partial<QueryState>;
  offline?: boolean;
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

beforeEach(() => {
  vi.clearAllMocks();
  setQueries({});
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
