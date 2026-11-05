import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDayTime, formatTimestampFull } from "@repo/formatting";
import { denseListClassName } from "@/components/shared/table-controls";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { AUDIT_PAGE_SIZE, olderAuditCursor } from "./points-audit-card";

const MICROSECOND_CURSOR = "2026-03-14T09:08:07.123456+00:00";

const fixtures = vi.hoisted(() => ({
  data: [] as unknown[],
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  lastOptions: undefined as
    | {
        userId?: string;
        category?: string;
        flagged?: boolean;
        before?: string;
        limit?: number;
      }
    | undefined,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMemberDisplayNames: () => ({
    byId: { "user-1": "Alex" },
    nameFor: (id: string) => (id === "user-1" ? "Alex" : null),
  }),
  useOrgConfig: () => ({
    data: {
      points: {
        anomaly_threshold: 100,
        adjustment_rate_limit_per_hour: 50,
      },
    },
    isSuccess: true,
  }),
  usePointsTransactions: (options?: (typeof fixtures)["lastOptions"]) => {
    fixtures.lastOptions = options;
    return {
      data: fixtures.data,
      isPending: fixtures.isPending,
      isError: fixtures.isError,
      isFetching: fixtures.isFetching,
      refetch: fixtures.refetch,
    };
  },
}));

const gate = vi.hoisted(() => ({ denied: false }));

vi.mock("@/components/shared/can", () => ({
  Can: ({
    children,
    deniedFallback,
  }: {
    children: React.ReactNode;
    deniedFallback?: React.ReactNode;
  }) => <>{gate.denied ? deniedFallback : children}</>,
}));

const { PointsAuditCard } = await import("./points-audit-card");

function page(
  count: number,
  oldestCreatedAt = MICROSECOND_CURSOR,
): Array<{
  id: string;
  user_id: string;
  amount: number;
  category: "MANUAL";
  created_at?: string;
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `tx-${i}`,
    user_id: "user-1",
    amount: 1,
    category: "MANUAL" as const,
    created_at:
      i === count - 1
        ? oldestCreatedAt
        : `2026-03-14T10:00:00.${String(i).padStart(6, "0")}Z`,
  }));
}

describe("olderAuditCursor", () => {
  it("returns the oldest created_at verbatim on a full page", () => {
    const rows = page(AUDIT_PAGE_SIZE, MICROSECOND_CURSOR);
    expect(olderAuditCursor(rows)).toBe(MICROSECOND_CURSOR);
    // The regression #1832 fixed on the API: Date is millisecond-only.
    expect(olderAuditCursor(rows)).not.toBe(
      new Date(MICROSECOND_CURSOR).toISOString(),
    );
  });

  it("returns undefined when the page is short of the limit", () => {
    expect(olderAuditCursor(page(AUDIT_PAGE_SIZE - 1))).toBeUndefined();
    expect(olderAuditCursor([])).toBeUndefined();
  });

  it("returns undefined when the oldest row has no created_at", () => {
    const rows = page(AUDIT_PAGE_SIZE);
    delete rows[AUDIT_PAGE_SIZE - 1]!.created_at;
    expect(olderAuditCursor(rows)).toBeUndefined();
  });
});

describe("PointsAuditCard pagination", () => {
  beforeEach(() => {
    fixtures.data = [];
    fixtures.isPending = false;
    fixtures.isError = false;
    fixtures.isFetching = false;
    fixtures.refetch.mockReset();
    fixtures.lastOptions = undefined;
  });

  it("loads the first page with limit 100 and no before cursor", () => {
    fixtures.data = page(AUDIT_PAGE_SIZE);
    render(<PointsAuditCard />);

    expect(fixtures.lastOptions).toMatchObject({
      limit: AUDIT_PAGE_SIZE,
      before: undefined,
    });
    expect(
      screen.getByRole("button", { name: "Older transactions" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Newer transactions" }),
    ).toBeDisabled();
  });

  it("sends the oldest created_at verbatim as before when paging older", async () => {
    const user = userEvent.setup();
    fixtures.data = page(AUDIT_PAGE_SIZE, MICROSECOND_CURSOR);
    render(<PointsAuditCard />);

    await user.click(
      screen.getByRole("button", { name: "Older transactions" }),
    );

    expect(fixtures.lastOptions?.before).toBe(MICROSECOND_CURSOR);
    expect(fixtures.lastOptions?.before).not.toBe(
      new Date(MICROSECOND_CURSOR).toISOString(),
    );
  });

  it("returns to the first page without a cursor via Newer transactions", async () => {
    const user = userEvent.setup();
    fixtures.data = page(AUDIT_PAGE_SIZE, MICROSECOND_CURSOR);
    const view = render(<PointsAuditCard />);

    await user.click(
      screen.getByRole("button", { name: "Older transactions" }),
    );
    expect(fixtures.lastOptions?.before).toBe(MICROSECOND_CURSOR);

    fixtures.data = page(40);
    view.rerender(<PointsAuditCard />);
    expect(
      screen.getByRole("button", { name: "Older transactions" }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Newer transactions" }),
    );
    expect(fixtures.lastOptions?.before).toBeUndefined();
  });

  it("keeps Newer available when an older page fails to load", async () => {
    const user = userEvent.setup();
    fixtures.data = page(AUDIT_PAGE_SIZE, MICROSECOND_CURSOR);
    const view = render(<PointsAuditCard />);

    await user.click(
      screen.getByRole("button", { name: "Older transactions" }),
    );

    fixtures.isError = true;
    fixtures.data = [];
    view.rerender(<PointsAuditCard />);

    expect(screen.getByText("Audit unavailable")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Newer transactions" }),
    );

    expect(fixtures.lastOptions?.before).toBeUndefined();
  });

  it("does not offer Older transactions on a short first page", () => {
    fixtures.data = page(3);
    render(<PointsAuditCard />);

    expect(
      screen.queryByRole("button", { name: "Older transactions" }),
    ).not.toBeInTheDocument();
    expect(fixtures.lastOptions?.before).toBeUndefined();
  });

  it("resets the cursor when the flagged filter changes", async () => {
    const user = userEvent.setup();
    fixtures.data = page(AUDIT_PAGE_SIZE, MICROSECOND_CURSOR);
    render(<PointsAuditCard />);

    await user.click(
      screen.getByRole("button", { name: "Older transactions" }),
    );
    expect(fixtures.lastOptions?.before).toBe(MICROSECOND_CURSOR);

    const flaggedToggle = screen.getByRole("button", { name: "Flagged only" });
    expect(flaggedToggle).toHaveAttribute("aria-pressed", "false");
    await user.click(flaggedToggle);
    expect(flaggedToggle).toHaveAttribute("aria-pressed", "true");
    expect(fixtures.lastOptions).toMatchObject({
      before: undefined,
      flagged: true,
    });
  });

  it("resets the cursor when the category filter changes", async () => {
    const user = userEvent.setup();
    fixtures.data = page(AUDIT_PAGE_SIZE, MICROSECOND_CURSOR);
    render(<PointsAuditCard />);

    await user.click(
      screen.getByRole("button", { name: "Older transactions" }),
    );
    expect(fixtures.lastOptions?.before).toBe(MICROSECOND_CURSOR);

    await user.click(
      screen.getByRole("combobox", { name: "Filter audit by category" }),
    );
    await user.click(screen.getByRole("option", { name: "Fine" }));

    expect(fixtures.lastOptions).toMatchObject({
      before: undefined,
      category: "FINE",
    });
  });

  it("resets the cursor when the member filter changes", async () => {
    const user = userEvent.setup();
    fixtures.data = page(AUDIT_PAGE_SIZE, MICROSECOND_CURSOR);
    render(<PointsAuditCard />);

    await user.click(
      screen.getByRole("button", { name: "Older transactions" }),
    );
    expect(fixtures.lastOptions?.before).toBe(MICROSECOND_CURSOR);

    await user.click(
      screen.getByRole("combobox", { name: "Filter audit by member" }),
    );
    await user.click(screen.getByRole("option", { name: "Alex" }));

    expect(fixtures.lastOptions).toMatchObject({
      before: undefined,
      userId: "user-1",
    });
  });
});

describe("PointsAuditCard on the page surface", () => {
  beforeEach(() => {
    fixtures.data = [];
    fixtures.isPending = false;
    fixtures.isError = false;
    fixtures.isFetching = false;
    gate.denied = false;
  });

  it("is a flush Audit section with the chapter's limits as one state line", () => {
    fixtures.data = page(2);
    const { container } = render(<PointsAuditCard />);

    expect(screen.getByRole("region", { name: "Audit" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Flags at ±100 points · 50 adjustments per admin per hour",
        {
          exact: false,
        },
      ),
    ).toBeInTheDocument();
    // A moved threshold never re-checks old rows, and the tab says so.
    expect(
      screen.getByText("Each flag keeps the threshold it was raised under."),
    ).toBeInTheDocument();
    // The policy explanation the card used to carry is gone.
    expect(screen.queryByText(/chapter-configurable/)).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveClass(
      ...denseListClassName.split(" "),
    );
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("labels the category in sentence case and dates the row in the house shape", () => {
    const at = "2026-03-14T17:00:00Z";
    fixtures.data = [
      {
        id: "tx-1",
        user_id: "user-1",
        amount: -5,
        category: "FINE",
        description: "Late to chapter",
        created_at: at,
      },
    ];
    render(<PointsAuditCard />);

    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Fine");
    expect(row).not.toHaveTextContent("FINE");
    const time = row.querySelector("time");
    expect(time).toHaveAttribute("datetime", at);
    expect(time?.textContent).toBe(formatDayTime(at));
    expect(time).toHaveAttribute("title", formatTimestampFull(at));
    // No seconds in the visible date.
    expect(time?.textContent).not.toMatch(/:\d\d:\d\d/);
    expect(row).toHaveTextContent("-5 points");
  });

  it("draws no category, and no UNKNOWN, for a row without one", () => {
    fixtures.data = [{ id: "tx-1", user_id: "user-1", amount: 3 }];
    render(<PointsAuditCard />);

    expect(screen.queryByText("UNKNOWN")).not.toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Alex");
  });

  it("offers every ledger category in the filter, Academic included", async () => {
    const user = userEvent.setup();
    render(<PointsAuditCard />);

    await user.click(
      screen.getByRole("combobox", { name: "Filter audit by category" }),
    );
    expect(
      screen.getByRole("option", { name: "Academic" }),
    ).toBeInTheDocument();
  });

  it("says why the list is missing in one caption under the label when denied", () => {
    gate.denied = true;
    const { container } = render(<PointsAuditCard />);

    expect(screen.getByRole("region", { name: "Audit" })).toBeInTheDocument();
    expect(
      screen.getByText("Your role can't see every transaction."),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });
});
