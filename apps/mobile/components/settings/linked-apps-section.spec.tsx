import React from "react";
import { act } from "react";
import { Alert } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  google: undefined as Record<string, unknown> | undefined,
  googleError: false,
  refetch: vi.fn(),
  start: vi.fn(),
  authSession: vi.fn(),
  disconnect: vi.fn(),
  discord: undefined as Record<string, unknown> | undefined,
  sheetReturnPaths: [] as (string | undefined)[],
}));

vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: state.authSession,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useGoogleCalendarStatus: () => ({
    data: state.google,
    isError: state.googleError,
    refetch: state.refetch,
  }),
  useStartGoogleCalendarConnect: () => ({
    mutateAsync: state.start,
    isPending: false,
  }),
  useConfirmGoogleCalendarConnect: () => ({ mutateAsync: vi.fn() }),
  useDisconnectGoogleCalendar: () => ({
    mutateAsync: state.disconnect,
    isPending: false,
  }),
  useDiscordAuthorLink: () => ({ data: state.discord }),
}));

vi.mock("@/components/events/calendar-subscribe-sheet", () => ({
  CalendarSubscribeSheet: (props: { googleReturnPath?: string }) => {
    state.sheetReturnPaths.push(props.googleReturnPath);
    return null;
  },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      getUserIdentities: async () => ({
        data: {
          identities: [
            {
              provider: "apple",
              identity_data: { email: "x@privaterelay.appleid.com" },
            },
          ],
        },
        error: null,
      }),
      getUser: async () => ({ data: { user: { email: "me@frapp.live" } } }),
    },
  }),
}));

import {
  currentItemMenu,
  dismissItemMenu,
  pickItemMenuAction,
} from "@/components/item-actions-menu";
import { FrappThemeProvider } from "@/lib/theme";
import { LinkedAppsSection } from "./linked-apps-section";

const OFF = {
  available: true,
  connected: false,
  status: null,
  google_email: null,
  last_synced_at: null,
};

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <QueryClientProvider client={new QueryClient()}>
        <FrappThemeProvider>
          <LinkedAppsSection />
        </FrappThemeProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

function row(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      node.props.label === label && typeof node.props.description === "string",
  );
}

describe("Phone Settings → Linked apps (#5407)", () => {
  afterEach(() => {
    dismissItemMenu();
  });

  beforeEach(() => {
    state.google = OFF;
    state.googleError = false;
    state.refetch.mockReset();
    state.start.mockReset();
    state.start.mockResolvedValue("https://accounts.google.com/x");
    state.authSession.mockReset();
    state.authSession.mockResolvedValue({ type: "cancel" });
    state.disconnect.mockReset();
    state.discord = { available: true, linked: false };
    state.sheetReturnPaths = [];
    vi.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("connects Google from Settings and has the sign-in come back to Settings", async () => {
    const tree = await render();
    await act(async () => {
      row(tree, "Google Calendar").props.onPress();
    });
    expect(state.start).toHaveBeenCalledWith({
      client: "mobile",
      returnUrl: expect.stringContaining("preferences"),
    });
    // The Calendar apps sheet opened from here comes back here too.
    expect(state.sheetReturnPaths.at(-1)).toBe("preferences");
  });

  it("offers Reconnect and Disconnect on an expired connection", async () => {
    state.google = { ...OFF, connected: true, status: "needs_reconnect" };
    const tree = await render();
    expect(row(tree, "Google Calendar").props.accessibilityValue).toBe(
      "Expired",
    );
    act(() => row(tree, "Google Calendar").props.onPress());
    const menu = currentItemMenu()!;
    expect(menu.title).toBe("Google Calendar");
    expect(
      menu.actions.map((action) => [action.label, !!action.destructive]),
    ).toEqual([
      ["Reconnect", false],
      ["Disconnect", true],
    ]);
    expect(state.start).not.toHaveBeenCalled();

    await act(async () => {
      pickItemMenuAction("Reconnect");
    });
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(currentItemMenu()).toBeNull();
  });

  it("says a failed read and retries on a tap, rather than hiding the row", async () => {
    state.google = undefined;
    state.googleError = true;
    const tree = await render();
    act(() => row(tree, "Google Calendar").props.onPress());
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("marks each sign-in method by whether the account has it", async () => {
    const tree = await render();
    // The sign-in methods load through a query that settles a few ticks later.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(row(tree, "Apple").props.accessibilityValue).toBe("Connected");
    expect(row(tree, "Google").props.accessibilityValue).toBe("Not connected");
    expect(row(tree, "Email").props.accessibilityValue).toBe("Not connected");
  });
});
