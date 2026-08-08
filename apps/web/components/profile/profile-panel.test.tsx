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

  it("sends the stored zone unchanged when the member edits nothing else", async () => {
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
      expect(lastSettingsBody()?.quiet_hours_tz).toBe("America/New_York");
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
      await screen.findByText(/time zone this server recognizes/i),
    ).toBeTruthy();
    expect(mocks.updateSettingsMutateAsync).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
