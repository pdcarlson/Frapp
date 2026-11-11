/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NavigationContext,
  NavigationRouteContext,
} from "expo-router/react-navigation";
import { activityGroups, type Activity } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Chat's real task card inside the Activity sheet (#3897), where
 * `activity-sheet.spec.tsx` stubs the cards. It pins that a card draws and
 * acts outside a thread on what the sheet hands it: the message built from
 * the row, a frame with nothing to retry or react to, and the screen's
 * navigation context, which a sheet on a device does not inherit.
 */

const updateStatus = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePermissionList: () => [],
  useTask: (id: string) => ({
    data: id
      ? {
          id,
          status: "TODO",
          stored_status: "TODO",
          points_awarded: false,
        }
      : undefined,
  }),
  useUpdateTaskStatus: () => ({ mutateAsync: updateStatus, isPending: false }),
  useConfirmTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCurrentChapter: () => ({ data: { enabled_modules: {} } }),
  useReviewServiceEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: null }),
}));

// The poll hook's client, a native module this spec never reaches.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => null }));

/** What the card's subtree reads as its navigation context. */
const seen = vi.hoisted(() => ({ navigation: undefined as unknown }));
vi.mock("@/components/chat/use-card-write", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/chat/use-card-write")>();
  const ReactModule = await import("react");
  const nav = await import("expo-router/react-navigation");
  return {
    ...actual,
    useCardWrite: (input: Parameters<typeof actual.useCardWrite>[0]) => {
      seen.navigation = ReactModule.useContext(nav.NavigationContext);
      return actual.useCardWrite(input);
    },
  };
});

import { ActivitySheet } from "@/components/activity/activity-sheet";

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
    hours_approvals: [],
    polls: [],
  },
  coming_up: [],
  links: [],
  made_by_you: { polls: [], tasks: [], files: [], events: [] },
  needs_you_count: 1,
  unavailable: [],
} as unknown as Activity;

const taskRow = activityGroups(READ, "all")[0]!.rows[0]!;
const SCREEN_NAVIGATION = { name: "the Activity screen's navigation" };

describe("Activity sheet with chat's real task card (#3897)", () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    vi.clearAllMocks();
    seen.navigation = undefined;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NavigationContext.Provider value={SCREEN_NAVIGATION as never}>
            <NavigationRouteContext.Provider value={undefined}>
              <ActivitySheet
                row={taskRow as never}
                viewerId="me"
                onActed={() => {}}
                onClosed={() => {}}
                linkActions={{
                  canRemove: false,
                  open: () => {},
                  done: () => {},
                  hide: () => {},
                  openInChat: () => {},
                  remove: () => {},
                }}
              />
            </NavigationRouteContext.Provider>
          </NavigationContext.Provider>
        </FrappThemeProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it("draws the task from the row, with the assignee's own control", () => {
    const text = screenText(tree);
    expect(text).toContain("Book the venue");
    expect(text).toContain("Olive → Me");
    expect(text).toContain("Start");
  });

  it("acts on the task through the card's own write", async () => {
    const start = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Start",
    );
    expect(start.props.disabled).toBe(false);
    await act(async () => {
      start.props.onPress();
    });
    expect(updateStatus).toHaveBeenCalledWith({
      id: "task-1",
      body: { status: "IN_PROGRESS" },
    });
  });

  it("hands the card the screen's navigation context", () => {
    expect(seen.navigation).toBe(SCREEN_NAVIGATION);
  });
});
