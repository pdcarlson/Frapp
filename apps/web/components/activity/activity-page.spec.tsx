import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "./activity-rows";

const mockActivity = vi.fn();
const mockInvalidate = vi.fn();
const mockNetwork = vi.fn(() => ({ isOffline: false }));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    TASK_STATUS_LABELS: actual.TASK_STATUS_LABELS,
    TASK_CONFIRMED_LABEL: actual.TASK_CONFIRMED_LABEL,
    activityKeys: actual.activityKeys,
    useActiveChapterId: () => "chap-1",
    useActivity: () => mockActivity(),
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "me", isLoading: false }),
}));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => mockNetwork(),
}));
/*
  The panel is stubbed to its contract: which row it was handed, and the two
  callbacks. What the cards do inside it is chat's own tests' business; what
  this page owes is opening the right row and reacting to close and acted.
*/
vi.mock("./activity-panel", () => ({
  ActivityPanel: ({
    row,
    onClose,
    onActed,
  }: {
    row: ActivityRow | null;
    onClose: (key?: string) => void;
    onActed: () => void;
  }) =>
    row ? (
      <div data-testid="panel">
        <span>{`panel:${row.title}`}</span>
        <button onClick={() => onClose()}>close</button>
        <button onClick={() => onClose("some-other-row")}>late close</button>
        <button onClick={() => onClose(row.key)}>settled close</button>
        <button onClick={onActed}>acted</button>
      </div>
    ) : null,
}));

const { ActivityPage } = await import("./activity-page");

const task = {
  id: "t1",
  title: "Book the venue",
  due_date: "2099-01-01",
  status: "TODO",
  stored_status: "TODO",
  assignee_id: "me",
  assignee_name: "Me",
  created_by: "officer",
  created_by_name: "Olive",
  point_reward: null,
  completed_at: null,
  confirmed_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
};
const poll = {
  message_id: "p1",
  channel_id: "c1",
  channel_name: "general",
  channel_type: "PUBLIC",
  sender_id: "officer",
  question: "Formal venue?",
  option_count: 2,
  closes_at: "2099-01-01T00:00:00.000Z",
  closed_at: null,
  is_closed: false,
  has_voted: false,
  created_at: "2026-11-01T00:00:00.000Z",
  message: {},
};
const data = (overrides: Record<string, unknown> = {}) => ({
  needs_you: {
    tasks: [task],
    task_confirmations: [],
    hours_approvals: [],
    polls: [poll],
  },
  coming_up: [],
  made_by_you: {
    polls: [],
    tasks: [],
    files: [
      {
        id: "f1",
        source: "document",
        title: "Bylaws",
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
  },
  needs_you_count: 2,
  unavailable: [],
  ...overrides,
});
const loaded = (overrides: Record<string, unknown> = {}) => ({
  data: data(overrides),
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockNetwork.mockReturnValue({ isOffline: false });
});

describe("ActivityPage", () => {
  it("draws Needs you first, with each row's badge, and a file as a link to where it lives", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Needs you",
      "Coming up",
      "Made by you",
    ]);
    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByText("Book the venue")).toBeInTheDocument();
    expect(within(needs).getByText("Vote")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bylaws/ })).toHaveAttribute(
      "href",
      "/documents",
    );
    expect(
      screen.getByText("No events in the next two weeks."),
    ).toBeInTheDocument();
  });

  it("narrows to one kind under a chip, and leaves out the groups with nothing of it", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Polls" }));

    expect(screen.getByRole("button", { name: "Polls" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Formal venue?")).toBeInTheDocument();
    expect(screen.queryByText("Book the venue")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Coming up" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Made by you" })).toBeNull();
  });

  it("says a section could not be loaded instead of calling it empty", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [],
          task_confirmations: [],
          hours_approvals: [],
          polls: [],
        },
        unavailable: ["polls"],
      }),
    );
    render(<ActivityPage />);

    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByText(/Couldn't load polls/)).toBeInTheDocument();
    expect(
      within(needs).queryByText("Nothing is waiting on you."),
    ).not.toBeInTheDocument();
  });

  it("opens the row it was asked for in the panel", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
  });

  it("keeps the panel open when the row has left the list after an action", () => {
    mockActivity.mockReturnValue(loaded());
    const { rerender } = render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    // The vote landed: the re-read no longer lists the poll under Needs you.
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [task],
          task_confirmations: [],
          hours_approvals: [],
          polls: [],
        },
      }),
    );
    rerender(<ActivityPage />);

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Formal venue\?/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the list and the open panel when a re-read fails", () => {
    mockActivity.mockReturnValue(loaded());
    const { rerender } = render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    mockActivity.mockReturnValue({
      ...loaded(),
      isError: true,
      error: new Error("503"),
    });
    rerender(<ActivityPage />);

    expect(screen.getByText("Book the venue")).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load your activity"),
    ).not.toBeInTheDocument();
  });

  it("shows the error page only when there is nothing to show", () => {
    mockActivity.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("503"),
      refetch: vi.fn(),
    });
    render(<ActivityPage />);

    expect(screen.getByText("Couldn't load your activity")).toBeInTheDocument();
  });

  it("re-reads once when the panel is closed by hand, and once when an action settles", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(mockInvalidate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));
    fireEvent.click(screen.getByRole("button", { name: "acted" }));
    fireEvent.click(screen.getByRole("button", { name: "settled close" }));
    expect(screen.queryByTestId("panel")).toBeNull();
    // `acted` re-read; the settled close did not read a second time.
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
  });

  it("does not close the open row when another row's action answers late", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    fireEvent.click(screen.getByRole("button", { name: "late close" }));

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
  });
});
