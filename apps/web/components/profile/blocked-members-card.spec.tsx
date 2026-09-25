import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCK_LIST_WAITING_FOR_NETWORK,
  BLOCKED_MEMBERS_EMPTY_TITLE,
  BLOCKED_MEMBERS_ERROR_BODY,
  BLOCKED_MEMBERS_ERROR_TITLE,
  BLOCKED_MEMBERS_OFFLINE_BODY,
  BLOCKED_MEMBERS_SCOPE,
  BLOCKED_MEMBERS_STALE,
} from "@repo/chat-core/block-copy";
import type { BlockedUserIds } from "@repo/hooks";

const BLAKE = "22222222-2222-4222-8222-222222222222";
const ZED = "33333333-3333-4333-8333-333333333333";
const GONE = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  chapterId: "chapter-1" as string | null,
  list: null as unknown as BlockedUserIds,
  requestUnblock: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useActiveChapterId: () => state.chapterId,
    useBlockedUserIds: () => state.list,
    useMemberDisplayNames: () => ({
      nameFor: (id: string) =>
        id === BLAKE ? "Blake Moss" : id === ZED ? "Zed Ali" : null,
    }),
  };
});

vi.mock("@/components/chat/use-unblock-flow", () => ({
  useUnblockFlow: () => ({
    requestUnblock: state.requestUnblock,
    reloadMaskedCopies: vi.fn(),
    isPending: false,
    confirmDialog: null,
  }),
}));

const { BlockedMembersCard, BLOCKED_MEMBERS_EMPTY_BODY_WEB } =
  await import("./blocked-members-card");

function list(overrides: Partial<BlockedUserIds> = {}): BlockedUserIds {
  return {
    ids: new Set(),
    unblocked: new Set(),
    status: "ready",
    retry: vi.fn(),
    isRetrying: false,
    isPaused: false,
    readAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  state.chapterId = "chapter-1";
  state.list = list();
  state.requestUnblock.mockReset();
});

describe("BlockedMembersCard (#2313)", () => {
  it("lists blocked members by name, sorted, and unblocks through the shared flow", async () => {
    state.list = list({ ids: new Set([ZED, BLAKE]) });
    render(<BlockedMembersCard />);

    expect(screen.getByText(BLOCKED_MEMBERS_SCOPE)).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Blake MossUnblock",
      "Zed AliUnblock",
    ]);

    await userEvent.click(
      within(rows[0]!).getByRole("button", { name: "Unblock Blake Moss" }),
    );
    expect(state.requestUnblock).toHaveBeenCalledWith(BLAKE, "Blake Moss");
  });

  it("keeps a member the roster no longer lists, under a fallback label", async () => {
    state.list = list({ ids: new Set([GONE]) });
    render(<BlockedMembersCard />);

    const row = screen.getByRole("listitem");
    expect(row).not.toHaveTextContent(GONE);
    await userEvent.click(
      within(row).getByRole("button", { name: /^Unblock/ }),
    );
    // `null`, so the confirmation says "this member" rather than the label.
    expect(state.requestUnblock).toHaveBeenCalledWith(GONE, null);
  });

  it("says the list is empty only after a read confirmed it", () => {
    render(<BlockedMembersCard />);
    expect(screen.getByText(BLOCKED_MEMBERS_EMPTY_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText(BLOCKED_MEMBERS_EMPTY_BODY_WEB),
    ).toBeInTheDocument();
  });

  it("does not call a list that is still loading empty", () => {
    state.list = list({ status: "loading" });
    render(<BlockedMembersCard />);
    expect(screen.queryByText(BLOCKED_MEMBERS_EMPTY_TITLE)).toBeNull();
    expect(
      screen.getByText("Loading your blocked members"),
    ).toBeInTheDocument();
  });

  it("reports a failed first read, with Retry", async () => {
    const retry = vi.fn();
    state.list = list({ status: "unavailable", retry });
    render(<BlockedMembersCard />);

    expect(screen.getByText(BLOCKED_MEMBERS_ERROR_TITLE)).toBeInTheDocument();
    expect(screen.getByText(BLOCKED_MEMBERS_ERROR_BODY)).toBeInTheDocument();
    expect(screen.queryByText(BLOCKED_MEMBERS_EMPTY_TITLE)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says a parked first read loads when back online, with no Retry", () => {
    state.list = list({ status: "unavailable", isPaused: true });
    render(<BlockedMembersCard />);
    expect(screen.getByText(BLOCKED_MEMBERS_OFFLINE_BODY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps a cached list on screen when a refresh fails, and says so", () => {
    state.list = list({ status: "unavailable", ids: new Set([BLAKE]) });
    render(<BlockedMembersCard />);
    expect(screen.getByText("Blake Moss")).toBeInTheDocument();
    expect(screen.getByText(BLOCKED_MEMBERS_STALE)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Retry loading your blocked members",
      }),
    ).toBeInTheDocument();
  });

  it("says a stale list waits for the network instead of offering Retry", () => {
    state.list = list({
      status: "unavailable",
      ids: new Set([BLAKE]),
      isPaused: true,
    });
    render(<BlockedMembersCard />);
    expect(
      screen.getByText(BLOCK_LIST_WAITING_FOR_NETWORK),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Retry loading your blocked members",
      }),
    ).toBeNull();
  });

  it("asks for a chapter rather than spinning without one", () => {
    state.chapterId = null;
    state.list = list({ status: "loading" });
    render(<BlockedMembersCard />);
    expect(screen.getByText("Select a chapter")).toBeInTheDocument();
  });
});
