/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import * as expoRouter from "expo-router";
import { useRouter } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityKeys } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";

/**
 * The phone's Activity screen (#3897), rendered for real over a stubbed read
 * and a stubbed sheet: the groups and rows it draws, what a row opens, and
 * when it reads again. The sheet has its own spec
 * (`activity-sheet.spec.tsx`); the row model's is in `@repo/hooks`.
 *
 * It renders `app/(app)/activity.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
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
  ...overrides,
});

const file = (source: "document" | "backwork", id: string, title: string) => ({
  id,
  source,
  title,
  created_at: "2026-11-01T00:00:00.000Z",
});

const read = (overrides: Record<string, unknown> = {}) => ({
  needs_you: {
    tasks: [task()],
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
    polls: [],
  },
  coming_up: [],
  links: [],
  made_by_you: {
    polls: [],
    tasks: [],
    files: [
      file("document", "doc-1", "Bylaws"),
      file("backwork", "bw-1", "CS 101 midterm"),
    ],
    events: [],
  },
  needs_you_count: 2,
  unavailable: [] as string[],
  ...overrides,
});

const activity = vi.hoisted(() => ({
  value: {} as {
    data?: unknown;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    error?: unknown;
    refetch: () => Promise<unknown>;
  },
}));

/** The link writes, each a `mutateAsync` that resolves unless a test says not. */
const links = vi.hoisted(() => ({
  permissions: [] as string[],
  done: vi.fn(),
  hidden: vi.fn(),
  clear: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActivity: () => activity.value,
  useViewerUserId: () => "me",
  useActiveChapterId: () => "chapter-1",
  // Read by the back row and the chips for the chapter's accent.
  useCurrentChapter: () => ({ data: undefined }),
  useMyPermissions: () => ({ data: { permissions: links.permissions } }),
  useSetActivityLinkState: (state: "done" | "hidden") => ({
    mutateAsync: links[state],
  }),
  useClearActivityLinkState: () => ({ mutateAsync: links.clear }),
  useRemoveActivityLink: () => ({ mutateAsync: links.remove }),
  useRestoreActivityLink: () => ({ mutateAsync: links.restore }),
}));

/** The props the screen last handed its sheet. */
const sheet = vi.hoisted(() => ({
  props: null as null | {
    row: { key: string } | null;
    viewerId: string | null;
    onClosed: () => void;
    onActed: () => void;
    linkActions: import("@/components/activity/activity-sheet").LinkSheetActions;
  },
}));
const openLink = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/open-link", () => ({ openMessageLink: openLink }));

vi.mock("@/components/activity/activity-sheet", () => ({
  ActivitySheet: (props: NonNullable<typeof sheet.props>) => {
    sheet.props = props;
    return null;
  },
}));

import ActivityScreen from "@/app/(app)/activity";
import { FilterChips } from "@/components/filter-chips";
import { ListRow } from "@/components/list-section";
import { ScreenShell } from "@/components/screen-shell";
import { UndoBar } from "@/components/tasks/undo-bar";

const mounted: ReactTestRenderer[] = [];
let queryClient: QueryClient;

const screen = () => (
  <QueryClientProvider client={queryClient}>
    <FrappThemeProvider>
      <ActivityScreen />
    </FrappThemeProvider>
  </QueryClientProvider>
);

/** Every mounted focus effect, run again: the member came back. */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(screen());
  });
  mounted.push(tree);
  return tree;
}

const rowLabels = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ListRow).map((row) => row.props.label);

const row = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAllByType(ListRow).find((node) => node.props.label === label)!;

describe("Activity screen (#3897)", () => {
  beforeEach(() => {
    queryClient = new QueryClient();
    sheet.props = null;
    activity.value = {
      data: read(),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(() => Promise.resolve()),
    };
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
  });

  it("goes back to More", () => {
    expectBackRow(render(), "More", "/more");
  });

  it("lists what needs the member first, then what they made, each group with its count", () => {
    const tree = render();
    // Hours to approve is for now, the task due far off for later
    // (`activityRowIsNow`, #4173), so the approval leads.
    expect(rowLabels(tree)).toEqual([
      "Food bank",
      "Book the venue",
      "Bylaws",
      "CS 101 midterm",
    ]);
    const text = screenText(tree);
    expect(text).toContain("Needs you · 2");
    expect(text).toContain("Made by you · 2");
    // Nothing is coming up, and the group says so instead of vanishing.
    expect(text).toContain("No events in the next two weeks.");
  });

  it("names what a row asks of the member, for the eye and for a screen reader", () => {
    const tree = render();
    expect(row(tree, "Food bank").props.accessibilityValue).toBe("Approve");
    expect(row(tree, "Food bank").props.description).toBe("Sam Hill · 1h 30m");
    expect(screenText(tree)).toContain("Approve");
  });

  it("opens a row's record in the sheet, with the viewer's id", () => {
    const tree = render();
    expect(sheet.props?.row).toBeNull();
    act(() => {
      row(tree, "Book the venue").props.onPress();
    });
    expect(sheet.props?.row?.key).toBe("needs:task:task-1");
    expect(sheet.props?.viewerId).toBe("me");
  });

  it("keeps the sheet on the row it opened after that row leaves the list", () => {
    const tree = render();
    act(() => {
      row(tree, "Food bank").props.onPress();
    });
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: { ...read().needs_you, hours_approvals: [] },
      }),
    };
    act(() => {
      tree.update(screen());
    });
    expect(rowLabels(tree)).not.toContain("Food bank");
    expect(sheet.props?.row?.key).toBe("needs:hours:entry-1");
  });

  it("hands the sheet the row as the latest read has it", () => {
    const tree = render();
    act(() => {
      row(tree, "Book the venue").props.onPress();
    });
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: {
          ...read().needs_you,
          tasks: [task({ title: "Book the venue (moved)" })],
        },
      }),
    };
    act(() => {
      tree.update(screen());
    });
    expect(
      (sheet.props?.row as unknown as { title: string } | null)?.title,
    ).toBe("Book the venue (moved)");
  });

  it("reads again when the member comes back to the screen", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render();
    expect(invalidate).not.toHaveBeenCalled();
    act(() => refocus());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
  });

  it("re-reads on a pull, the gesture its couldn't-load note names", async () => {
    const tree = render();
    const refetch = vi.mocked(activity.value.refetch);
    await act(async () => {
      await tree.root.findByType(ScreenShell).props.refresh();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("reads again when the sheet closes, and after an action the sheet made", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const tree = render();
    act(() => {
      row(tree, "Book the venue").props.onPress();
    });
    act(() => {
      sheet.props!.onActed();
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => {
      sheet.props!.onClosed();
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
    expect(sheet.props?.row).toBeNull();
  });

  it("sends a document row to Documents, and gives a backwork row nowhere to go", () => {
    const tree = render();
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => {
      row(tree, "Bylaws").props.onPress();
    });
    expect(push).toHaveBeenCalledWith("/documents");
    expect(sheet.props?.row).toBeNull();
    // The phone has no Backwork screen, so the row is a record only.
    expect(row(tree, "CS 101 midterm").props.onPress).toBeUndefined();
  });

  it("narrows every group to one kind under a chip, keeping Needs you", () => {
    const tree = render();
    act(() => {
      tree.root.findByType(FilterChips).props.onSelect("file");
    });
    expect(rowLabels(tree)).toEqual(["Bylaws", "CS 101 midterm"]);
    const text = screenText(tree);
    expect(text).toContain("Needs you");
    expect(text).toContain("Nothing of this kind here.");
    expect(text).not.toContain("Coming up");
  });

  it("says which section couldn't load instead of showing it as empty", () => {
    activity.value = {
      ...activity.value,
      data: read({
        needs_you: { ...read().needs_you, tasks: [], hours_approvals: [] },
        unavailable: ["polls"],
      }),
    };
    const text = screenText(render());
    expect(text).toContain("Couldn't load polls. Pull down to try again.");
    expect(text).not.toContain("Nothing is waiting on you.");
  });

  it("shows the loading rows before the first read, and no list", () => {
    activity.value = { ...activity.value, data: undefined, isPending: true };
    const tree = render();
    expect(rowLabels(tree)).toEqual([]);
    expect(screenText(tree)).not.toContain("Needs you");
  });

  it("offers a retry when the first read fails", () => {
    const refetch = vi.fn(() => Promise.resolve());
    activity.value = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new Error("boom"),
      refetch,
    };
    const tree = render();
    expect(screenText(tree)).toContain("Couldn't load your activity");
    const retry = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Try again",
    );
    act(() => {
      retry.props.onPress();
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the list it has when a later read fails", () => {
    activity.value = {
      ...activity.value,
      isError: true,
      error: new Error("boom"),
    };
    const tree = render();
    expect(rowLabels(tree)).toContain("Book the venue");
    expect(screenText(tree)).not.toContain("Couldn't load your activity");
  });

  describe("sign-up links", () => {
    const link = (overrides: Record<string, unknown> = {}) => ({
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
      ...overrides,
    });
    type LinkRow = Parameters<
      NonNullable<typeof sheet.props>["linkActions"]["done"]
    >[0];

    beforeEach(() => {
      links.permissions = [];
      for (const write of [
        links.done,
        links.hidden,
        links.clear,
        links.remove,
        links.restore,
      ]) {
        write.mockResolvedValue(undefined);
      }
      activity.value = { ...activity.value, data: read({ links: [link()] }) };
    });

    it("lists them in their own group, and opens one in the sheet", () => {
      const tree = render();
      expect(screenText(tree)).toContain("Links · 1");
      act(() => {
        row(tree, "Google Form").props.onPress();
      });
      expect(sheet.props?.row?.key).toBe("link:l1");
      expect(sheet.props?.linkActions.canRemove).toBe(false);
    });

    it("lets only a channels:manage holder remove one for everyone", () => {
      links.permissions = ["channels:manage"];
      render();
      expect(sheet.props?.linkActions.canRemove).toBe(true);
    });

    const linkRow = () => ({ link: link(), title: "Google Form" }) as LinkRow;

    it.each([
      ["done", "Marked done", "clear"],
      ["hide", "Hidden", "clear"],
      ["remove", "Removed from everyone's Activity", "restore"],
    ] as const)(
      "offers Undo once %s lands, and Undo takes it back with the matching write",
      async (action, message, takeBack) => {
        const tree = render();
        const write = {
          done: links.done,
          hide: links.hidden,
          remove: links.remove,
        }[action];
        await act(async () => {
          sheet.props!.linkActions[action](linkRow());
        });
        expect(write).toHaveBeenCalledWith("l1");
        const bar = tree.root.findByType(UndoBar);
        expect(bar.props.message).toBe(message);
        await act(async () => {
          bar.props.onUndo();
        });
        expect(links[takeBack]).toHaveBeenCalledWith("l1");
        expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
      },
    );

    it("says a failed write with the platform alert, and offers no Undo", async () => {
      const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
      links.hidden.mockRejectedValueOnce(new Error("nope"));
      const tree = render();
      await act(async () => {
        sheet.props!.linkActions.hide(linkRow());
      });
      expect(alert).toHaveBeenCalledWith(
        "Couldn't hide it",
        expect.any(String),
      );
      expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
    });

    it("opens the link in the in-app browser", () => {
      render();
      act(() => {
        sheet.props!.linkActions.open(linkRow());
      });
      expect(openLink).toHaveBeenCalledWith("https://forms.gle/abc");
    });

    it("leaves the re-read to the write when the sheet closes behind one", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      render();
      await act(async () => {
        sheet.props!.linkActions.done(linkRow());
      });
      act(() => {
        sheet.props!.onClosed();
      });
      expect(invalidate).not.toHaveBeenCalled();
      // Only that one close: the next one re-reads as usual.
      act(() => {
        sheet.props!.onClosed();
      });
      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it("opens a thread reply in its thread, and a channel message in its channel", () => {
      render();
      const push = vi.mocked(useRouter().push);
      push.mockClear();
      act(() => {
        sheet.props!.linkActions.openInChat({
          link: link({ thread_root_id: "root-1" }),
        } as LinkRow);
      });
      expect(push).toHaveBeenLastCalledWith({
        pathname: "/chat-thread",
        params: { channelId: "chan-1", threadRootId: "root-1" },
      });
      act(() => {
        sheet.props!.linkActions.openInChat({ link: link() } as LinkRow);
      });
      expect(push).toHaveBeenLastCalledWith({
        pathname: "/chat-thread",
        params: { channelId: "chan-1" },
      });
    });
  });
});
