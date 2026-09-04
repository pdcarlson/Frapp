import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// A successful sign-out (or account deletion, which signs out on success)
// replaces the document; jsdom's real location.assign throws "not
// implemented", so stand in for it and assert the destination.
const locationAssign = vi.fn();
Object.defineProperty(window, "location", {
  value: { ...window.location, assign: locationAssign },
  writable: true,
});

// Every mocked hook must return a STABLE reference. The panel's effects depend
// on `userQuery.data` / `settingsQuery.data`, so a fresh object per render loops
// forever ("Maximum update depth exceeded") — a test artifact, not a bug.
const { mockOffline } = vi.hoisted(() => ({ mockOffline: { value: false } }));

const mocks = vi.hoisted(() => {
  const noopMutation = {
    mutateAsync: () => Promise.resolve({}),
    isPending: false,
  };
  return {
    settingsData: undefined as Record<string, unknown> | undefined,
    updateSettingsMutateAsync: vi.fn(),
    toast: vi.fn(),
    // `fetchStatus` and `isLoading` are read by the state branches the #920
    // Profile & pre-auth slice added; the fixtures below drive them per test.
    userQuery: {
      data: { id: "u-1", email: "member@example.com", display_name: "Member" } as
        | Record<string, unknown>
        | undefined,
      isPending: false,
      isLoading: false,
      isError: false,
      fetchStatus: "idle" as string,
      refetch: vi.fn(),
    },
    settingsQuery: {
      data: undefined as Record<string, unknown> | undefined,
      isPending: false,
      isLoading: false,
      isError: false,
      fetchStatus: "idle" as string,
      refetch: vi.fn(),
    },
    noopMutation,
    updateSettings: {
      mutateAsync: () => Promise.resolve({}) as Promise<unknown>,
      isPending: false,
      // Read by the panel's hydrate effect since #312 made the settings
      // mutation optimistic — see the rollback test at the bottom of this file.
      isError: false,
    },
    deleteAccount: {
      mutateAsync: vi.fn(() => Promise.resolve({})),
      isPending: false,
    },
    signOutCurrentSession: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("@repo/hooks", () => ({
  useCurrentUser: () => mocks.userQuery,
  useUserSettings: () => mocks.settingsQuery,
  useUpdateUser: () => mocks.noopMutation,
  useUpdateUserSettings: () => mocks.updateSettings,
  useUpdateOnboarding: () => mocks.noopMutation,
  useDeleteAccount: () => mocks.deleteAccount,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/auth/session", () => ({
  signOutCurrentSession: () => mocks.signOutCurrentSession(),
}));
vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

import { networkMock } from "@/tests/network";
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

/**
 * Everything below was added by the #920 Profile & pre-auth slice.
 *
 * The fixtures above are shared, so each block resets what it drives — an
 * offline flag or a paused `fetchStatus` left set leaks into every later test
 * in the file, which is the hazard `tests/network.ts` warns about by name.
 */
function resetQueries() {
  mockOffline.value = false;
  mocks.userQuery.data = {
    id: "u-1",
    email: "member@example.com",
    display_name: "Member",
  };
  mocks.userQuery.isPending = false;
  mocks.userQuery.isLoading = false;
  mocks.userQuery.isError = false;
  mocks.userQuery.fetchStatus = "idle";
  mocks.settingsQuery.data = undefined;
  mocks.settingsQuery.isPending = false;
  mocks.settingsQuery.isLoading = false;
  mocks.settingsQuery.isError = false;
  mocks.settingsQuery.fetchStatus = "idle";
}

describe("ProfilePanel — offline, then loading, then error, then the screen", () => {
  beforeEach(resetQueries);

  it("states the network rather than spinning, when nothing is cached", () => {
    mockOffline.value = true;
    mocks.userQuery.data = undefined;
    mocks.userQuery.isPending = true;
    mocks.userQuery.fetchStatus = "paused";
    render(<ProfilePanel />);

    expect(screen.getByText(/unavailable offline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("keeps a cached profile on screen while a paused refetch waits", () => {
    /*
     * The half a later "simplification" silently breaks, which is why it is
     * pinned rather than left implicit — `components/shared/can-fallback.spec.tsx`
     * pins the same one for the permission query. A paused *refetch* still has
     * `data`, so the member keeps their screen and their drafts; only a pause
     * with nothing cached is a state worth rendering.
     */
    mockOffline.value = true;
    mocks.userQuery.fetchStatus = "paused";
    mocks.settingsQuery.data = { quiet_hours_start: "22:00" };
    render(<ProfilePanel />);

    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(
      screen.queryByText(/your profile is unavailable offline/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/loading your profile/i)).not.toBeInTheDocument();
    // And the second query's card holds its cached values too, for the same
    // reason — the two branches are the same rule applied at two scales.
    expect(screen.getByDisplayValue("22:00")).toBeInTheDocument();
  });

  it("keeps the drafts when a BACKGROUND refetch fails", async () => {
    /*
     * The defect this branch replaces, and the reason it is not a style
     * preference. TanStack v5 keeps `data` through a background refetch
     * failure, so the old `if (userQuery.isError)` unmounted the whole panel —
     * both drafts with it — when a window-focus refetch failed. On a screen
     * whose entire purpose is holding text a member is part-way through
     * typing, that discards their work and says nothing about it.
     *
     * Same shape as `<Can>`'s `isError && !data` since #1211, met on a form.
     */
    // `rerender`, never a second `render()`. RTL's `render` mounts a *new*
    // tree without unmounting the first, so a second call gives you a fresh
    // ProfilePanel whose draft seeds from `userQuery.data` — which is still
    // "Member". The test then passes whether or not the draft survives,
    // because it is reading a panel that was never typed into. Verified: with
    // a second `render()`, adding `userQuery.isError` to the seeding effect's
    // dependency array — the exact regression this test names — leaves it
    // green.
    const { rerender } = render(<ProfilePanel />);
    const name = screen.getByLabelText("Display name");
    await userEvent.clear(name);
    await userEvent.type(name, "Half-typed name");

    mocks.userQuery.isError = true;
    mocks.userQuery.fetchStatus = "idle";
    // The data is still there — that is what a background failure looks like.
    rerender(<ProfilePanel />);

    expect(screen.queryByText(/couldn't load your profile/i)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Half-typed name")).toBeInTheDocument();
  });

  it("still fails closed when the fetch failed and nothing is cached", () => {
    mocks.userQuery.data = undefined;
    mocks.userQuery.isError = true;
    render(<ProfilePanel />);

    expect(screen.getByText(/couldn't load your profile/i)).toBeInTheDocument();
  });
});

describe("ProfilePanel — the Preferences card has its own states", () => {
  beforeEach(resetQueries);

  it("refuses to offer Save when the stored preferences could not be read", () => {
    /*
     * #1209's shape, one screen over. `settingsQuery` had no branch at all, so
     * a failed `/v1/settings` fetch rendered empty time fields beside a live
     * Save button — and because the submit maps an unloaded field to
     * `undefined`, pressing it sent an empty body and toasted "Preferences
     * saved". A failure reported as a success.
     */
    mocks.settingsQuery.isError = true;
    render(<ProfilePanel />);

    expect(screen.getByText(/couldn't load your preferences/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save preferences/i }),
    ).not.toBeInTheDocument();
  });

  it("says offline rather than failed when the connection is the reason", () => {
    // The mistake `/documents` and `/backwork` made before `NestedOffline`
    // existed: reaching for the error variant and telling a member with a
    // dropped connection that something had failed.
    mockOffline.value = true;
    mocks.settingsQuery.isPending = true;
    mocks.settingsQuery.fetchStatus = "paused";
    render(<ProfilePanel />);

    expect(screen.getByText(/quiet hours unavailable offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load your preferences/i)).not.toBeInTheDocument();
  });

  it("leaves the screen-scale announcement to the top-level state", () => {
    // `sole` is deliberately not passed: the panel owns a screen-scale
    // `LoadingState`, so the live region and the `<h2>` promotion belong to
    // that one. This is the case `nested-states.tsx` describes as the default.
    mocks.settingsQuery.isLoading = true;
    render(<ProfilePanel />);

    const heading = screen.queryByRole("heading", { name: /preferences/i });
    // `CardTitle` is a `<div>`, so the card's own title is not a heading — and
    // the nested state must not add a second one.
    expect(heading).toBeNull();
  });
});

describe("ProfilePanel — the theme control is gone, not hidden", () => {
  beforeEach(resetQueries);

  it("renders no theme control", () => {
    // `next-themes` and the header toggle went in the #920 shell slice, and
    // `spec/ui/web-dashboard/README.md` has asserted "no user-facing theme
    // switch" ever since. Nothing on any surface reads `user_settings.theme`.
    render(<ProfilePanel />);
    expect(screen.queryByLabelText(/theme/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/theme controls/i)).not.toBeInTheDocument();
  });

  it("stops sending `theme` in the preferences PATCH", async () => {
    // The write path, not just the control. `notification.service.ts` resolves
    // an omitted field as `data.theme ?? existing?.theme ?? 'system'`, so
    // omitting it preserves whatever is stored rather than clearing it.
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
    expect(lastSettingsBody()).not.toHaveProperty("theme");
  });

  it("says Signet, not Frapp", () => {
    render(<ProfilePanel />);
    expect(screen.queryByText(/frapp/i)).not.toBeInTheDocument();
  });
});

// #713: mobile already shipped a delete-account surface
// (apps/mobile/app/(tabs)/preferences.tsx); this is the web half, gated
// behind the shared confirm dialog rather than `window.confirm`
// (spec/ui/design-system/README.md §9's every-surface ban, #1198).
describe("ProfilePanel — delete account (#713)", () => {
  beforeEach(() => {
    resetQueries();
    vi.clearAllMocks();
    mocks.deleteAccount.mutateAsync = vi.fn(() => Promise.resolve({}));
    mocks.deleteAccount.isPending = false;
    mocks.signOutCurrentSession = vi.fn(() => Promise.resolve());
  });

  // The trigger and the dialog's own confirm button would otherwise share the
  // exact accessible name "Delete account" — the trailing ellipsis (a
  // standard "this opens a confirmation" affordance) is what keeps
  // `getByRole` unambiguous outside of `within(dialog)` scoping too.
  async function openDeleteConfirmation() {
    await userEvent.click(
      screen.getByRole("button", { name: /^delete account…$/i }),
    );
    await screen.findByRole("dialog");
  }

  function clickDialogConfirm() {
    const dialog = screen.getByRole("dialog");
    return userEvent.click(
      within(dialog).getByRole("button", { name: /^delete account$/i }),
    );
  }

  it("does not call the delete mutation until the confirmation dialog is accepted", async () => {
    render(<ProfilePanel />);
    await openDeleteConfirmation();

    expect(mocks.deleteAccount.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("does nothing when the confirmation is canceled", async () => {
    render(<ProfilePanel />);
    await openDeleteConfirmation();

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(mocks.deleteAccount.mutateAsync).not.toHaveBeenCalled();
    expect(locationAssign).not.toHaveBeenCalled();
  });

  it("deletes the account and signs out locally once confirmed", async () => {
    render(<ProfilePanel />);
    await openDeleteConfirmation();
    await clickDialogConfirm();

    await waitFor(() => {
      expect(mocks.deleteAccount.mutateAsync).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mocks.signOutCurrentSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(locationAssign).toHaveBeenCalledWith("/sign-in");
    });
  });

  it("reports a retry-safe failure and leaves the trigger clickable when deletion errors", async () => {
    mocks.deleteAccount.mutateAsync = vi.fn(() =>
      Promise.reject(new Error("boom")),
    );
    render(<ProfilePanel />);
    await openDeleteConfirmation();
    await clickDialogConfirm();

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Deletion didn't finish",
        }),
      );
    });
    expect(locationAssign).not.toHaveBeenCalled();
    expect(mocks.signOutCurrentSession).not.toHaveBeenCalled();
    // A deletion that never succeeded is safe — and meaningful — to retry.
    expect(
      screen.getByRole("button", { name: /^delete account…$/i }),
    ).toBeEnabled();
  });

  // The account is already gone once the mutation resolves; a sign-out
  // hiccup right after must not strand the member on this page with a stale
  // cache and a re-enabled trigger inviting a pointless second delete against
  // an account that no longer exists (the bug three independent /diff-review
  // lenses converged on: the old code awaited `handleSignOut()` — which
  // swallows its own errors and only navigates on its own success path —
  // inside the same try, so a sign-out failure here left the page fully
  // interactive with nothing telling the member their account was deleted).
  it("still redirects when sign-out fails right after a successful deletion", async () => {
    mocks.signOutCurrentSession = vi.fn(() =>
      Promise.reject(new Error("network blip")),
    );
    render(<ProfilePanel />);
    await openDeleteConfirmation();
    await clickDialogConfirm();

    await waitFor(() => {
      expect(mocks.deleteAccount.mutateAsync).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(locationAssign).toHaveBeenCalledWith("/sign-in");
    });
    // No "Couldn't sign out" (or any) toast — the deletion itself succeeded,
    // and the redirect already happened; a toast here would be stale by the
    // time anyone could read it.
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("disables Sign out while a delete is in flight, so it can't abort the in-flight request", async () => {
    let resolveDelete!: () => void;
    mocks.deleteAccount.mutateAsync = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDelete = () => resolve({});
        }),
    );
    render(<ProfilePanel />);
    await openDeleteConfirmation();
    await clickDialogConfirm();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^sign out$/i }),
      ).toBeDisabled();
    });

    resolveDelete();
    await waitFor(() => {
      expect(locationAssign).toHaveBeenCalledWith("/sign-in");
    });
  });
});
