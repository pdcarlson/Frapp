/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityGroups, type Activity } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { moduleDisabledMessage } from "@repo/validation";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { screenText } from "@/test/screen-text";

/**
 * The sheet an Activity row opens (#3897): which of chat's cards it draws for
 * a row and what it hands it, and the two things it adds under a card, a
 * poll's "Open in chat" and a pending service entry's review. The cards are
 * stubbed; each has its own spec beside it in `components/chat/`.
 */

const cards = vi.hoisted(() => ({
  task: [] as Record<string, unknown>[],
  event: [] as Record<string, unknown>[],
  poll: [] as Record<string, unknown>[],
  hours: [] as Record<string, unknown>[],
}));
vi.mock("@/components/chat/task-card", () => ({
  TaskCard: (props: Record<string, unknown>) => {
    cards.task.push(props);
    return null;
  },
}));
vi.mock("@/components/chat/event-card", () => ({
  EventCard: (props: Record<string, unknown>) => {
    cards.event.push(props);
    return null;
  },
}));
vi.mock("@/components/chat/poll-card", () => ({
  PollCard: (props: Record<string, unknown>) => {
    cards.poll.push(props);
    return null;
  },
}));
vi.mock("@/components/chat/hours-card", () => ({
  HoursCard: (props: Record<string, unknown>) => {
    cards.hours.push(props);
    return null;
  },
}));

const poll = vi.hoisted(() => ({
  value: {
    message: { id: "msg-1", kind: "poll" },
    votesFailed: false,
    votesLoading: false,
    refusal: null as string | null,
    vote: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("@/lib/activity/use-activity-poll", () => ({
  useActivityPoll: () => poll.value,
}));

const review = vi.hoisted(() => ({
  mutateAsync: vi.fn<(input: unknown) => Promise<unknown>>(),
  isPending: false,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useReviewServiceEntry: () => review,
  // Read by the sheet's chrome and buttons for the chapter's accent.
  useCurrentChapter: () => ({ data: undefined }),
}));

/** `null` online; the offline copy from `lib/connection/state.ts` otherwise. */
let writeBlockedReason: string | null = null;
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason }),
}));

import {
  ActivitySheet,
  type ActivitySheetRow,
} from "@/components/activity/activity-sheet";

const READ = {
  needs_you: {
    tasks: [
      {
        id: "task-1",
        title: "Book the venue",
        due_date: "2099-01-01",
        status: "TODO",
        stored_status: "TODO",
        assignee_id: "me",
        assignee_name: "Me",
        created_by: "officer",
        created_by_name: "Olive",
        point_reward: 10,
        completed_at: null,
        confirmed_at: null,
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
    task_confirmations: [],
    hours_approvals: [
      {
        id: "entry-1",
        user_id: "u-2",
        member_name: "Sam Hill",
        date: "2026-11-01",
        duration_minutes: 90,
        description: "Food bank",
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
    polls: [
      {
        message_id: "msg-1",
        channel_id: "chan-1",
        channel_name: "general",
        channel_type: "PUBLIC",
        question: "Formal venue?",
        closes_at: null,
        is_closed: false,
        has_voted: false,
        created_at: "2026-11-01T00:00:00.000Z",
        message: { id: "msg-1", kind: "poll" },
      },
    ],
  },
  links: [],
  coming_up: [
    {
      id: "event-1",
      name: "Chapter meeting",
      location: "Great Hall",
      start_time: "2099-01-01T18:00:00.000Z",
      end_time: "2099-01-01T19:00:00.000Z",
      attendance: "required",
      point_value: 5,
      check_in_opens_minutes: 15,
      check_in_open: false,
      checked_in: false,
    },
  ],
  made_by_you: { polls: [], tasks: [], files: [], events: [] },
  needs_you_count: 3,
  unavailable: [],
} as unknown as Activity;

/** The real row the screen would hand the sheet for one kind. */
function rowOf(kind: ActivitySheetRow["kind"]): ActivitySheetRow {
  return activityGroups(READ, "all")
    .flatMap((group) => group.rows)
    .find((row) => row.kind === kind) as ActivitySheetRow;
}

const mounted: ReactTestRenderer[] = [];
const onActed = vi.fn();
const onClosed = vi.fn();
const linkActions = {
  canRemove: false,
  open: vi.fn(),
  done: vi.fn(),
  hide: vi.fn(),
  openInChat: vi.fn(),
  remove: vi.fn(),
};

const present = vi.fn();
const dismiss = vi.fn();

function sheetElement(row: ActivitySheetRow | null, viewerId: string | null) {
  return (
    <FrappThemeProvider>
      <ActivitySheet
        row={row}
        viewerId={viewerId}
        onActed={onActed}
        onClosed={onClosed}
        linkActions={linkActions}
      />
    </FrappThemeProvider>
  );
}

function render(
  row: ActivitySheetRow | null,
  viewerId: string | null = "me",
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(sheetElement(row, viewerId), {
      // `vitest.setup.ts` mocks `BottomSheetModal` as a host string, so the
      // sheet's ref lands on whatever this returns for it.
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal"
          ? { present, dismiss }
          : null,
    });
  });
  mounted.push(tree);
  return tree;
}

const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );

describe("Activity sheet (#3897)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const list of Object.values(cards)) list.length = 0;
    poll.value = {
      ...poll.value,
      votesFailed: false,
      votesLoading: false,
      refusal: null,
    };
    review.isPending = false;
    review.mutateAsync.mockResolvedValue({});
    writeBlockedReason = null;
    linkActions.canRemove = false;
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.restoreAllMocks();
  });

  describe("opening and closing", () => {
    const modal = (tree: ReactTestRenderer) =>
      tree.root.find((node) => (node.type as unknown) === "BottomSheetModal");

    it("stays down with no row, and presents once when a row is opened", () => {
      const tree = render(null);
      expect(present).not.toHaveBeenCalled();
      act(() => tree.update(sheetElement(rowOf("task"), "me")));
      expect(present).toHaveBeenCalledTimes(1);
    });

    it("does not present again when a re-read hands the same row down as a new object", () => {
      const tree = render(rowOf("task"));
      expect(present).toHaveBeenCalledTimes(1);
      act(() => tree.update(sheetElement({ ...rowOf("task") }, "me")));
      expect(present).toHaveBeenCalledTimes(1);
    });

    it("presents again for a different row", () => {
      const tree = render(rowOf("task"));
      act(() => tree.update(sheetElement(rowOf("hours"), "me")));
      expect(present).toHaveBeenCalledTimes(2);
    });

    it("tells the screen when the sheet has gone", () => {
      const tree = render(rowOf("task"));
      act(() => {
        modal(tree).props.onDismiss();
      });
      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it("closes from the header's X", () => {
      const tree = render(rowOf("task"));
      act(() => {
        button(tree, "Close").props.onPress();
      });
      expect(dismiss).toHaveBeenCalledTimes(1);
    });
  });

  it("draws chat's task card from the row, as a confirmed message of the viewer's", () => {
    render(rowOf("task"));
    const props = cards.task.at(-1)!;
    expect(props.viewerId).toBe("me");
    expect(props.isConfirmed).toBe(true);
    expect(props.payload).toMatchObject({
      task_id: "task-1",
      title: "Book the venue",
      assignee_user_id: "me",
      point_reward: 10,
    });
    // Not a message in a channel: no message actions to open.
    expect(props.onOpenActions).toBeUndefined();
  });

  it("draws chat's event card with the member's own attendance answer", () => {
    render(rowOf("event"));
    expect(cards.event.at(-1)!.payload).toMatchObject({
      event_id: "event-1",
      is_mandatory: true,
      check_in_opens_minutes: 15,
    });
  });

  it("opens the event's details screen from Open event, closing the sheet first", () => {
    const tree = render(rowOf("event"));
    const push = vi.mocked(useRouter().push);
    act(() => {
      button(tree, "Open event").props.onPress();
    });
    expect(push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "event-1" },
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("waits for the viewer's id before drawing a card", () => {
    const tree = render(rowOf("task"), null);
    expect(cards.task).toHaveLength(0);
    expect(screenText(tree)).toContain("Loading your account…");
  });

  describe("a poll", () => {
    it("votes through the detached-card hook", () => {
      render(rowOf("poll"));
      const props = cards.poll.at(-1)!;
      expect(props.isConfirmed).toBe(true);
      (props.onVote as (...args: unknown[]) => void)("msg-1", "vote", {
        option_id: "a",
      });
      expect(poll.value.vote).toHaveBeenCalledWith("msg-1", "vote", {
        option_id: "a",
      });
    });

    it("holds the vote until the votes are read, and says so when they can't be", () => {
      poll.value = { ...poll.value, votesLoading: true };
      render(rowOf("poll"));
      expect(cards.poll.at(-1)!.isConfirmed).toBe(false);

      poll.value = { ...poll.value, votesLoading: false, votesFailed: true };
      const tree = render(rowOf("poll"));
      expect(cards.poll.at(-1)!.isConfirmed).toBe(false);
      expect(screenText(tree)).toContain("voting is paused here");
    });

    it("draws a refused vote's reason under the card", () => {
      poll.value = { ...poll.value, refusal: "This poll has closed." };
      expect(screenText(render(rowOf("poll")))).toContain(
        "This poll has closed.",
      );
    });

    it("asks before closing the poll", () => {
      const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      render(rowOf("poll"));
      (cards.poll.at(-1)!.onClosePoll as (id: string) => void)("msg-1");
      expect(alert).toHaveBeenCalledTimes(1);
      expect(poll.value.close).not.toHaveBeenCalled();
    });

    it("opens the poll's channel from Open in chat", () => {
      const tree = render(rowOf("poll"));
      const push = vi.mocked(useRouter().push);
      act(() => {
        button(tree, "Open in chat").props.onPress();
      });
      expect(push).toHaveBeenCalledWith({
        pathname: "/chat-thread",
        params: { channelId: "chan-1" },
      });
      // The sheet goes first, or it would sit over the thread.
      expect(dismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("a pending service entry", () => {
    it("approves it, stays open on the result and tells the screen", async () => {
      const tree = render(rowOf("hours"));
      expect(cards.hours.at(-1)!.payload).toMatchObject({
        entry_id: "entry-1",
        user_name: "Sam Hill",
      });
      await act(async () => {
        button(tree, "Approve").props.onPress();
      });
      expect(review.mutateAsync).toHaveBeenCalledWith({
        id: "entry-1",
        body: { status: "APPROVED" },
      });
      expect(onActed).toHaveBeenCalledTimes(1);
      const text = screenText(tree);
      expect(text).toContain("Approved.");
      // The review is recorded: nothing left to press twice.
      expect(text).not.toContain("Reject");
    });

    it("asks before rejecting, and rejects only on the confirm", async () => {
      const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      const tree = render(rowOf("hours"));
      act(() => {
        button(tree, "Reject").props.onPress();
      });
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0]![0]).toBe('Reject "Food bank"?');
      expect(review.mutateAsync).not.toHaveBeenCalled();

      const confirm = alert.mock.calls[0]![2]!.find(
        (option) => option.style === "destructive",
      )!;
      await act(async () => {
        confirm.onPress!();
      });
      expect(review.mutateAsync).toHaveBeenCalledWith({
        id: "entry-1",
        body: { status: "REJECTED" },
      });
      expect(screenText(tree)).toContain("Rejected.");
    });

    it("keeps the buttons and says why when the review is refused", async () => {
      // A 403 reads as the house line for a role that can't (`errorCopy`).
      review.mutateAsync.mockRejectedValue({ statusCode: 403 });
      const tree = render(rowOf("hours"));
      await act(async () => {
        button(tree, "Approve").props.onPress();
      });
      expect(onActed).not.toHaveBeenCalled();
      expect(screenText(tree)).toContain("Your role can't do this.");
      expect(button(tree, "Approve").props.disabled).toBe(false);
    });

    it("says a subscription refusal in a member's words", async () => {
      review.mutateAsync.mockRejectedValue({
        statusCode: 403,
        error: "Forbidden",
        message:
          "Chapter subscription is not active; complete checkout to use this feature.",
      });
      const tree = render(rowOf("hours"));
      await act(async () => {
        button(tree, "Approve").props.onPress();
      });
      expect(screenText(tree)).toContain(
        SUBSCRIPTION_REFUSAL_COPY.serviceReview,
      );
    });

    it("says a switched-off module in a member's words", async () => {
      review.mutateAsync.mockRejectedValue({
        statusCode: 403,
        error: "Forbidden",
        message: moduleDisabledMessage("hours"),
      });
      const tree = render(rowOf("hours"));
      await act(async () => {
        button(tree, "Approve").props.onPress();
      });
      expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.serviceReview);
    });

    it("holds the review while a write would be lost", () => {
      writeBlockedReason = "You're offline.";
      const tree = render(rowOf("hours"));
      for (const label of ["Approve", "Reject"]) {
        expect(button(tree, label).props.disabled).toBe(true);
        expect(button(tree, label).props.accessibilityHint).toBe(
          "You're offline.",
        );
      }
    });
  });

  describe("a sign-up link", () => {
    const linkRow = {
      kind: "link",
      key: "link:l1",
      title: "Google Form",
      detail: "Olive · #rush · Tue 3:00 PM",
      badge: null,
      link: {
        id: "l1",
        url: "https://forms.gle/abc",
        host: "forms.gle",
        message_id: "m1",
        thread_root_id: null,
        channel_id: "chan-1",
        channel_name: "rush",
        channel_type: "PUBLIC",
        posted_by: "olive",
        posted_by_name: "Olive",
        posted_at: "2026-11-10T15:00:00.000Z",
      },
    } as unknown as ActivitySheetRow;

    it("says what it is and where it goes, and opens it without closing the sheet", () => {
      const tree = render(linkRow);
      const text = screenText(tree);
      expect(text).toContain("Google Form");
      expect(text).toContain("https://forms.gle/abc");
      act(() => {
        button(tree, "Open link").props.onPress();
      });
      expect(linkActions.open).toHaveBeenCalledWith(linkRow);
      expect(dismiss).not.toHaveBeenCalled();
    });

    it.each([
      ["Done", "done"],
      ["Hide", "hide"],
      ["Open in chat", "openInChat"],
    ] as const)(
      "closes the sheet, then hands %s to the screen",
      (label, key) => {
        const tree = render(linkRow);
        act(() => {
          button(tree, label).props.onPress();
        });
        expect(dismiss).toHaveBeenCalledTimes(1);
        expect(linkActions[key]).toHaveBeenCalledWith(linkRow);
      },
    );

    it("offers Remove for everyone only to an officer", () => {
      const member = render(linkRow);
      expect(() => button(member, "Remove for everyone")).toThrow();

      linkActions.canRemove = true;
      const officer = render(linkRow);
      act(() => {
        button(officer, "Remove for everyone").props.onPress();
      });
      expect(linkActions.remove).toHaveBeenCalledWith(linkRow);
    });
  });
});
