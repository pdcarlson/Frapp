/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NavigationContext,
  NavigationRouteContext,
} from "expo-router/react-navigation";
import { activityReviewRows, type Activity } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Chat's real task card inside the Activity sheet (#3897), where
 * `activity-sheet.spec.tsx` stubs the cards. It pins that a card draws and
 * acts outside a thread on what the sheet hands it: the message built from
 * the row, a frame with nothing to retry or react to, and the screen's
 * navigation context, which a sheet on a device does not inherit.
 */

const confirmTask = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // An officer, reviewing a member's completion: the one task row the
  // sheet still opens (#5492); every other pushes the task's screen.
  usePermissionList: () => ["tasks:manage"],
  useTask: (id: string) => ({
    data: id
      ? {
          id,
          assignee_id: "sam",
          status: "COMPLETED",
          stored_status: "COMPLETED",
          points_awarded: false,
          point_reward: 10,
          proof_kind: "none",
        }
      : undefined,
  }),
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmTask: () => ({ mutateAsync: confirmTask, isPending: false }),
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
    tasks: [],
    task_confirmations: [
      {
        id: "task-1",
        title: "Book the venue",
        due_date: "2099-01-01",
        status: "COMPLETED",
        stored_status: "COMPLETED",
        assignee_id: "sam",
        assignee_name: "Sam",
        created_by: "me",
        created_by_name: "Olive",
        point_reward: 10,
        proof_kind: "none",
        completed_at: "2026-11-02T00:00:00.000Z",
        confirmed_at: null,
        created_at: "2026-11-01T00:00:00.000Z",
      },
    ],
    hours_approvals: [],
    polls: [],
  },
  coming_up: [],
  links: [],
  made_by_you: { polls: [], tasks: [], events: [] },
  needs_you_count: 1,
  unavailable: [],
} as unknown as Activity;

const taskRow = activityReviewRows(READ)[0]!;
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
                reminderActions={{
                  open: () => {},
                  snooze: () => {},
                  done: () => {},
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

  it("draws the completion from the row, with the officer's Confirm and Send back", () => {
    const text = screenText(tree);
    expect(text).toContain("Book the venue");
    expect(text).toContain("Olive → Sam");
    expect(text).toContain("Confirm");
    expect(text).toContain("Send back");
  });

  it("confirms through the card's own write", async () => {
    const confirm = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Confirm",
    );
    expect(confirm.props.disabled).toBe(false);
    await act(async () => {
      confirm.props.onPress();
    });
    expect(confirmTask).toHaveBeenCalledWith("task-1");
  });

  it("hands the card the screen's navigation context", () => {
    expect(seen.navigation).toBe(SCREEN_NAVIGATION);
  });
});
