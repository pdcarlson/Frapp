import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Every mocked hook must return a STABLE reference. The panel's effects depend
// on `userQuery.data` / `settingsQuery.data`, so a fresh object per render loops
// forever ("Maximum update depth exceeded") — a test artifact, not a bug.
const mocks = vi.hoisted(() => {
  const noopMutation = {
    mutateAsync: () => Promise.resolve({}),
    isPending: false,
  };
  return {
    settingsData: undefined as Record<string, unknown> | undefined,
    updateSettingsMutateAsync: vi.fn(),
    toast: vi.fn(),
    userQuery: {
      data: { id: "u-1", email: "member@example.com", display_name: "Member" },
      isPending: false,
      isError: false,
    },
    settingsQuery: { data: undefined as Record<string, unknown> | undefined },
    noopMutation,
    updateSettings: {
      mutateAsync: () => Promise.resolve({}) as Promise<unknown>,
      isPending: false,
      // Read by the panel's hydrate effect since #312 made the settings
      // mutation optimistic — see the rollback test at the bottom of this file.
      isError: false,
    },
  };
});

vi.mock("@repo/hooks", () => ({
  useCurrentUser: () => mocks.userQuery,
  useUserSettings: () => mocks.settingsQuery,
  useUpdateUser: () => mocks.noopMutation,
  useUpdateUserSettings: () => mocks.updateSettings,
  useUpdateOnboarding: () => mocks.noopMutation,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/auth/session", () => ({ signOutCurrentSession: vi.fn() }));

import { ProfilePanel } from "./profile-panel";

/** The body the panel would PATCH, or undefined if it never submitted. */
function lastSettingsBody() {
  const calls = mocks.updateSettingsMutateAsync.mock.calls;
  return calls[calls.length - 1]?.[0];
}

async function savePreferences() {
  await userEvent.click(
    screen.getByRole("button", { name: /save preferences/i }),
  );
}

describe("ProfilePanel — quiet-hours timezone save (#687)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsQuery.data = undefined;
    mocks.updateSettingsMutateAsync.mockResolvedValue({});
    mocks.updateSettings.mutateAsync = mocks.updateSettingsMutateAsync;
    mocks.updateSettings.isPending = false;
    mocks.updateSettings.isError = false;
  });

  // The headline regression of this change. The Preferences card renders before
  // the settings query resolves, so the draft is empty — and mapping that absent
  // value to an explicit null would tell the server to CLEAR the member's stored
  // zone. Absent must stay absent so the PATCH omits the field.
  it("omits quiet_hours_tz entirely when the settings query has not loaded", async () => {
    mocks.settingsQuery.data = undefined;
    render(<ProfilePanel />);

    await savePreferences();

    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalled();
    });
    expect(lastSettingsBody()).toHaveProperty("quiet_hours_tz", undefined);
    expect(lastSettingsBody().quiet_hours_tz).not.toBeNull();
  });

  // Omitted, not echoed. Re-sending a value the member never touched is how a
  // client ends up overwriting the server with its own stale idea of it; the
  // server already has this zone and nothing here should restate it.
  it("omits an untouched stored zone so the server keeps its own value", async () => {
    mocks.settingsQuery.data = {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "America/New_York",
      theme: "system",
    };
    render(<ProfilePanel />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("America/New_York")).toBeTruthy();
    });
    await savePreferences();

    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalled();
    });
    expect(lastSettingsBody()).toHaveProperty("quiet_hours_tz", undefined);
  });

  it("sends the edited zone when the member changes it to a valid one", async () => {
    mocks.settingsQuery.data = {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "America/New_York",
      theme: "system",
    };
    render(<ProfilePanel />);

    const input = await screen.findByDisplayValue("America/New_York");
    await userEvent.clear(input);
    await userEvent.type(input, "Europe/Berlin");
    await savePreferences();

    await waitFor(() => {
      expect(lastSettingsBody()?.quiet_hours_tz).toBe("Europe/Berlin");
    });
  });

  // Blank is a clear, not an error — otherwise a member holding an unusable
  // stored zone could never save their way out of it.
  it("sends null when the member clears the timezone field", async () => {
    mocks.settingsQuery.data = {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "America/New_York",
      theme: "system",
    };
    render(<ProfilePanel />);

    const input = await screen.findByDisplayValue("America/New_York");
    await userEvent.clear(input);
    await savePreferences();

    await waitFor(() => {
      expect(lastSettingsBody()?.quiet_hours_tz).toBeNull();
    });
  });

  // This browser's tzdata can be older than the server's, so our verdict on a
  // zone we never showed the member being edited is unreliable. Judging it would
  // abort the whole save over an untouched field — and "fixing" it would
  // overwrite a zone the server considers valid, on every device.
  it("does not judge an untouched stored zone this browser cannot resolve", async () => {
    mocks.settingsQuery.data = {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "Mars/Olympus",
      theme: "system",
    };
    render(<ProfilePanel />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Mars/Olympus")).toBeTruthy();
    });
    await savePreferences();

    // The save goes through, and the untouched zone is omitted rather than
    // cleared or rewritten — the server keeps what it has.
    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalled();
    });
    expect(lastSettingsBody()).toHaveProperty("quiet_hours_tz", undefined);
    expect(
      screen.queryByText(/time zone name this server recognizes/i),
    ).toBeNull();
  });

  it("blocks the save and explains when the zone cannot be resolved", async () => {
    mocks.settingsQuery.data = {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
      quiet_hours_tz: "America/New_York",
      theme: "system",
    };
    render(<ProfilePanel />);

    const input = await screen.findByDisplayValue("America/New_York");
    await userEvent.clear(input);
    await userEvent.type(input, "Mars/Olympus");
    await savePreferences();

    expect(
      await screen.findByText(/time zone name this server recognizes/i),
    ).toBeTruthy();
    expect(mocks.updateSettingsMutateAsync).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});

// #312 made `useUpdateUserSettings` optimistic, which changed how often this
// panel's hydrate effect fires: `settingsQuery.data` is now written on mutate
// and written again on rollback, where before it only changed once, on the
// success refetch. That extra write lands on a form the member is still
// looking at.
describe("ProfilePanel — draft survives an optimistic rollback (#312)", () => {
  const STORED = {
    quiet_hours_start: "22:00",
    quiet_hours_end: "08:00",
    quiet_hours_tz: "America/New_York",
    theme: "system",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsQuery.data = { ...STORED };
    mocks.updateSettingsMutateAsync.mockResolvedValue({});
    mocks.updateSettings.mutateAsync = mocks.updateSettingsMutateAsync;
    mocks.updateSettings.isPending = false;
    mocks.updateSettings.isError = false;
  });

  it("keeps the member's edits when a failed save rolls the cache back", async () => {
    mocks.updateSettingsMutateAsync.mockRejectedValue(new Error("Network down"));
    const { rerender } = render(<ProfilePanel />);

    const start = await screen.findByDisplayValue("22:00");
    await userEvent.clear(start);
    await userEvent.type(start, "21:00");
    await savePreferences();

    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalled();
    });

    // What the rollback actually does: restores the snapshot, which is a
    // different object than the one the panel last hydrated from. The identity
    // change is what re-runs the effect — the values being unchanged is
    // exactly why the bug was invisible without a test.
    mocks.updateSettings.isError = true;
    mocks.settingsQuery.data = { ...STORED };
    rerender(<ProfilePanel />);

    expect(screen.getByDisplayValue("21:00")).toBeTruthy();
    expect(screen.queryByDisplayValue("22:00")).toBeNull();
  });

  it("resyncs from the server once a save succeeds", async () => {
    const { rerender } = render(<ProfilePanel />);

    const start = await screen.findByDisplayValue("22:00");
    await userEvent.clear(start);
    await userEvent.type(start, "21:00");
    await savePreferences();

    // The success path is unchanged: `onSettled` invalidates, the refetch
    // lands, and the server's value — normalized or not — wins.
    mocks.settingsQuery.data = { ...STORED, quiet_hours_start: "21:00" };
    rerender(<ProfilePanel />);

    expect(screen.getByDisplayValue("21:00")).toBeTruthy();
  });
});
