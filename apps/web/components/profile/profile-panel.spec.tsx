import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    photoControl: vi.fn<
      (props: { hasPhoto: boolean; disabled?: boolean }) => null
    >(() => null),
    // `fetchStatus` and `isLoading` are read by the state branches the #920
    // Profile & pre-auth slice added; the fixtures below drive them per test.
    userQuery: {
      data: {
        id: "u-1",
        email: "member@example.com",
        display_name: "Member",
      } as Record<string, unknown> | undefined,
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
    updateUser: {
      mutateAsync: vi.fn<(body: Record<string, unknown>) => Promise<unknown>>(
        () => Promise.resolve({}),
      ),
      isPending: false,
    },
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
    // #564's Notifications card. `chapterId` is separate from the query fixture
    // because the no-chapter branch is reached by the ID being null while the
    // query never runs: `useNotificationPreferences` is `enabled: !!chapterId`,
    // and a disabled query reports `isLoading: false` (v5 derives it as
    // `isPending && isFetching`), so it never reaches the loading rung at all.
    chapterId: "chap-1" as string | null,
    preferencesQuery: {
      data: undefined as unknown,
      isPending: false,
      isLoading: false,
      isError: false,
      fetchStatus: "idle" as string,
      refetch: vi.fn(),
    },
    updatePreferenceMutateAsync: vi.fn(),
  };
});

// The Blocked members card reads the block list and the unblock flow, and has
// its own spec (`blocked-members-card.spec.tsx`). These cases are about the
// other cards, so it renders as an inert stand-in here.
// `@repo/validation`'s beta list, emptied so these specs draw every
// notification switch as they do with dues on. The beta's own case, dues
// off, sets `betaOff.keys`.
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation/beta-off-modules", () => ({
  get BETA_OFF_MODULES() {
    return betaOff.keys;
  },
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));
afterEach(() => {
  betaOff.keys = [];
});

vi.mock("@/components/profile/blocked-members-card", () => ({
  BlockedMembersCard: () => null,
}));
// Likewise the Discord history card (#2878), which has its own spec
// (`discord-history-card.spec.tsx`) and reads hooks this file does not mock.
vi.mock("@/components/profile/discord-history-card", () => ({
  DiscordHistoryCard: () => null,
}));
// Likewise the photo control (`profile-photo-control.spec.tsx`), though it
// records its props: whether the panel disables it offline is the panel's job.
vi.mock("@/components/profile/profile-photo-control", () => ({
  ProfilePhotoControl: (props: { hasPhoto: boolean; disabled?: boolean }) =>
    mocks.photoControl(props),
}));

vi.mock("@repo/hooks", () => ({
  useCurrentUser: () => mocks.userQuery,
  useUserSettings: () => mocks.settingsQuery,
  useUpdateUser: () => mocks.updateUser,
  useUpdateUserSettings: () => mocks.updateSettings,
  useUpdateOnboarding: () => mocks.noopMutation,
  useDeleteAccount: () => mocks.deleteAccount,
  useActiveChapterId: () => mocks.chapterId,
  useNotificationPreferences: () => mocks.preferencesQuery,
  useUpdateNotificationPreference: () => ({
    mutateAsync: mocks.updatePreferenceMutateAsync,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/auth/session", () => ({
  signOutCurrentSession: () => mocks.signOutCurrentSession(),
}));
vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

import { NOTIFICATION_CATEGORIES } from "@repo/validation";
import { networkMock } from "@/tests/network";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { ProfilePanel } from "./profile-panel";

/** The body the panel would PATCH, or undefined if it never submitted. */
function lastSettingsBody() {
  const calls = mocks.updateSettingsMutateAsync.mock.calls;
  return calls[calls.length - 1]?.[0];
}

async function savePreferences() {
  await userEvent.click(
    screen.getByRole("button", { name: /save quiet hours/i }),
  );
}

/**
 * Quiet hours (owner, 2026-11-06): a switch, the times only while it is on,
 * and the zone as a fact rather than a typed field. A member with no zone
 * gets this browser's; a stored zone is never replaced without a click,
 * because this browser's tzdata can be older than the server's.
 */
describe("ProfilePanel — quiet hours switch and zone", () => {
  const ON = {
    quiet_hours_start: "22:00",
    quiet_hours_end: "08:00",
    quiet_hours_tz: "America/New_York",
    theme: "system",
  };
  const OFF = {
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_tz: null,
    theme: "system",
  };
  const quietSwitch = () =>
    screen.getByRole("switch", { name: /quiet hours/i });

  afterEach(() => {
    mockOffline.value = false;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    mocks.updateSettingsMutateAsync.mockResolvedValue({});
    mocks.updateSettings.mutateAsync = mocks.updateSettingsMutateAsync;
    mocks.updateSettings.isPending = false;
    mocks.updateSettings.isError = false;
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: "America/New_York",
    });
  });

  it("shows only the switch while quiet hours are off", () => {
    mocks.settingsQuery.data = OFF;
    render(<ProfilePanel />);

    expect(quietSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /save quiet hours/i }),
    ).toBeNull();
  });

  it("turns on with 10 PM to 8 AM in this browser's zone for a member with none", async () => {
    mocks.settingsQuery.data = OFF;
    render(<ProfilePanel />);

    await userEvent.click(quietSwitch());

    await waitFor(() => {
      expect(lastSettingsBody()).toEqual({
        quiet_hours_start: "22:00",
        quiet_hours_end: "08:00",
        quiet_hours_tz: "America/New_York",
      });
    });
  });

  it("turns off by clearing the window", async () => {
    mocks.settingsQuery.data = ON;
    render(<ProfilePanel />);

    expect(quietSwitch().getAttribute("aria-checked")).toBe("true");
    await userEvent.click(quietSwitch());

    await waitFor(() => {
      expect(lastSettingsBody()).toEqual({
        quiet_hours_start: null,
        quiet_hours_end: null,
        quiet_hours_tz: null,
      });
    });
  });

  it("saves times without touching the stored zone", async () => {
    mocks.settingsQuery.data = ON;
    render(<ProfilePanel />);

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "23:30" },
    });
    await savePreferences();

    await waitFor(() => {
      expect(lastSettingsBody()).toEqual({
        quiet_hours_start: "23:30",
        quiet_hours_end: "08:00",
      });
    });
  });

  it("says nothing about the zone when it is this browser's", () => {
    mocks.settingsQuery.data = ON;
    render(<ProfilePanel />);

    expect(screen.queryByText(/times are in/i)).toBeNull();
  });

  // Never re-judged: a zone this browser cannot even resolve stays stored
  // until the member asks for this browser's instead.
  it("names a different stored zone and replaces it only on a click", async () => {
    mocks.settingsQuery.data = { ...ON, quiet_hours_tz: "Mars/Olympus" };
    render(<ProfilePanel />);

    expect(screen.getByText(/times are in olympus time/i)).toBeTruthy();
    await savePreferences();
    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalled();
    });
    expect(lastSettingsBody()).not.toHaveProperty("quiet_hours_tz");

    await userEvent.click(
      screen.getByRole("button", { name: /use new york time/i }),
    );
    await waitFor(() => {
      expect(lastSettingsBody()).toEqual({
        quiet_hours_tz: "America/New_York",
      });
    });
  });

  // The server evaluates a window stored with no zone in UTC, so that is the
  // zone the line names, with the same one-click fix.
  it("names UTC when a window is stored with no zone", async () => {
    mocks.settingsQuery.data = { ...ON, quiet_hours_tz: null };
    render(<ProfilePanel />);

    expect(screen.getByText(/times are in utc time/i)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: /use new york time/i }),
    );
    await waitFor(() => {
      expect(lastSettingsBody()).toEqual({
        quiet_hours_tz: "America/New_York",
      });
    });
  });

  it("brings back the member's window and zone when switched off and on", async () => {
    mocks.settingsQuery.data = {
      ...ON,
      quiet_hours_start: "23:15",
      quiet_hours_end: "06:45",
      quiet_hours_tz: "Europe/Lisbon",
    };
    const { rerender } = render(<ProfilePanel />);

    await userEvent.click(quietSwitch());
    await waitFor(() => {
      expect(lastSettingsBody()).toMatchObject({ quiet_hours_start: null });
    });

    // What the off save leaves stored.
    mocks.settingsQuery.data = OFF;
    rerender(<ProfilePanel />);
    await userEvent.click(quietSwitch());

    await waitFor(() => {
      expect(lastSettingsBody()).toEqual({
        quiet_hours_start: "23:15",
        quiet_hours_end: "06:45",
        quiet_hours_tz: "Europe/Lisbon",
      });
    });
  });

  it("refuses the switch offline and says so", async () => {
    mocks.settingsQuery.data = ON;
    mockOffline.value = true;
    render(<ProfilePanel />);

    await userEvent.click(quietSwitch());

    expect(mocks.updateSettingsMutateAsync).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "You're offline" }),
    );
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
    mocks.updateSettingsMutateAsync.mockRejectedValue(
      new Error("Network down"),
    );
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

  it("paints no card on the loaded screen or any of its states", () => {
    // The Page grammar's "no wrapper card": `/profile` was seven stacked
    // `Card`s. Each block is a section on the page surface now, and the
    // screen-level states are the nested family with `sole`.
    const loaded = render(<ProfilePanel />);
    expect(cardFilledContainers(loaded.container)).toEqual([]);
    loaded.unmount();

    mocks.userQuery.data = undefined;
    mocks.userQuery.isPending = true;
    mocks.userQuery.isLoading = true;
    const loading = render(<ProfilePanel />);
    expect(cardFilledContainers(loading.container)).toEqual([]);
    loading.unmount();

    mocks.userQuery.isPending = false;
    mocks.userQuery.isLoading = false;
    mocks.userQuery.isError = true;
    const failed = render(<ProfilePanel />);
    expect(screen.getByText(/couldn't load your profile/i)).toBeInTheDocument();
    expect(cardFilledContainers(failed.container)).toEqual([]);
    failed.unmount();

    mocks.userQuery.isError = false;
    mocks.userQuery.isPending = true;
    mocks.userQuery.fetchStatus = "paused";
    mockOffline.value = true;
    const offline = render(<ProfilePanel />);
    expect(cardFilledContainers(offline.container)).toEqual([]);
  });

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
    mocks.settingsQuery.data = {
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
    };
    render(<ProfilePanel />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(
      screen.queryByText(/your profile is unavailable offline/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/loading your profile/i)).not.toBeInTheDocument();
    // And the second query's card holds its cached values too, for the same
    // reason — the two branches are the same rule applied at two scales.
    expect(screen.getByDisplayValue("22:00")).toBeInTheDocument();
  });

  it("disables the photo control offline, and only offline", () => {
    mockOffline.value = true;
    const { rerender } = render(<ProfilePanel />);
    expect(mocks.photoControl).toHaveBeenLastCalledWith(
      expect.objectContaining({ disabled: true }),
    );

    mockOffline.value = false;
    rerender(<ProfilePanel />);
    expect(mocks.photoControl).toHaveBeenLastCalledWith(
      expect.objectContaining({ disabled: false }),
    );
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
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Half-typed name");

    mocks.userQuery.isError = true;
    mocks.userQuery.fetchStatus = "idle";
    // The data is still there — that is what a background failure looks like.
    rerender(<ProfilePanel />);

    expect(
      screen.queryByText(/couldn't load your profile/i),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Half-typed name")).toBeInTheDocument();
  });

  it("keeps an unsaved edit when a photo change refetches the profile (#732)", async () => {
    const { rerender } = render(<ProfilePanel />);
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Half-typed name");

    // What `useConfirmAvatar`'s invalidation lands: a new payload whose only
    // change is the photo, while the member is mid-edit.
    mocks.userQuery.data = {
      ...mocks.userQuery.data,
      bio: "Set elsewhere",
      avatar_url: "https://signed/photo",
    };
    rerender(<ProfilePanel />);

    expect(screen.getByDisplayValue("Half-typed name")).toBeInTheDocument();
    // A field the member never touched still follows the server.
    expect(screen.getByDisplayValue("Set elsewhere")).toBeInTheDocument();
  });

  it("still fails closed when the fetch failed and nothing is cached", () => {
    mocks.userQuery.data = undefined;
    mocks.userQuery.isError = true;
    render(<ProfilePanel />);

    expect(screen.getByText(/couldn't load your profile/i)).toBeInTheDocument();
  });
});

describe("ProfilePanel — the Quiet hours section has its own states", () => {
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

    expect(
      screen.getByText(/couldn't load your preferences/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save quiet hours/i }),
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

    expect(
      screen.getByText(/quiet hours unavailable offline/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/couldn't load your preferences/i),
    ).not.toBeInTheDocument();
  });

  it("leaves the screen-scale announcement to the top-level state", () => {
    // `sole` is deliberately not passed: the panel owns a screen-scale
    // `LoadingState`, so the live region and the `<h2>` promotion belong to
    // that one. This is the case `nested-states.tsx` describes as the default.
    mocks.settingsQuery.isLoading = true;
    render(<ProfilePanel />);

    // The section's own label is the one heading named for it; the nested
    // state must not add a second.
    expect(
      screen.getAllByRole("heading", { name: /quiet hours/i }),
    ).toHaveLength(1);
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
      expect(screen.getByDisplayValue("22:00")).toBeTruthy();
    });
    await savePreferences();

    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalled();
    });
    expect(lastSettingsBody()).not.toHaveProperty("theme");
  });

  it("never says Signet", () => {
    render(<ProfilePanel />);
    expect(screen.queryByText(/signet/i)).not.toBeInTheDocument();
  });
});

// #713: mobile already shipped a delete-account surface
// (apps/mobile/app/(app)/preferences.tsx); this is the web half, gated
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

/**
 * The Notifications card (#564) — web's half of the shared catalog.
 *
 * These assert the *states* mobile already solved, per the issue's brief. The
 * grid itself is deliberately not pinned row-by-row: it renders straight from
 * `NOTIFICATION_CATEGORIES`, and `packages/validation`'s spec is what pins the
 * catalog's contents. Asserting them again here would be a second copy of the
 * list — the exact thing sharing the catalog exists to prevent.
 */
describe("ProfilePanel — notification categories (#564)", () => {
  beforeEach(() => {
    // `mockReset`, not just `clearAllMocks`: the failure test below installs an
    // implementation that rejects, and `vi.clearAllMocks()` clears calls but
    // NOT implementations (this project sets neither `restoreMocks` nor
    // `mockReset` in `vitest.config.ts`). Without this, every test appended
    // after that one inherits a forced failure and silently asserts a path
    // that never ran.
    vi.clearAllMocks();
    mocks.updatePreferenceMutateAsync.mockReset();
    mocks.updatePreferenceMutateAsync.mockResolvedValue({});
    mockOffline.value = false;
    mocks.chapterId = "chap-1";
    mocks.preferencesQuery.data = [];
    mocks.preferencesQuery.isPending = false;
    mocks.preferencesQuery.isLoading = false;
    mocks.preferencesQuery.isError = false;
    mocks.preferencesQuery.fetchStatus = "idle";
    mocks.settingsQuery.data = { quiet_hours_tz: "America/New_York" };
    mocks.updateSettings.mutateAsync = mocks.updateSettingsMutateAsync;
    mocks.updateSettings.isPending = false;
    mocks.updateSettings.isError = false;
  });

  function categorySwitch(name: RegExp) {
    return screen.getByRole("switch", { name });
  }

  /** The category grid's switches, without the Quiet hours one above it. */
  function categorySwitches() {
    return screen
      .queryAllByRole("switch")
      .filter((element) => element.id.startsWith("notification-category-"));
  }

  it("renders a switch for every catalog category", () => {
    render(<ProfilePanel />);
    expect(categorySwitches()).toHaveLength(NOTIFICATION_CATEGORIES.length);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(
        screen.getByRole("switch", {
          name: new RegExp(`^${category.label}$`, "i"),
        }),
      ).toBeTruthy();
    }
  });

  it("draws no Billing switch while dues is beta-off", () => {
    betaOff.keys = ["dues"];
    render(<ProfilePanel />);
    expect(categorySwitches()).toHaveLength(NOTIFICATION_CATEGORIES.length - 1);
    expect(screen.queryByRole("switch", { name: /^billing$/i })).toBeNull();
  });

  // The hydrate case. An absent row means enabled — that is what the server
  // does with one — so a member who has never touched a category must see its
  // switch ON, not off-by-default.
  it("shows a category with no stored row as enabled", () => {
    mocks.preferencesQuery.data = [{ category: "points", is_enabled: false }];
    render(<ProfilePanel />);
    expect(categorySwitch(/^points$/i)).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    expect(categorySwitch(/^events$/i)).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  // A row for a category the catalog does not draw must not leak into the
  // grid: `notification_preferences.category` is unconstrained `text`.
  it("ignores stored rows for categories outside the catalog", () => {
    mocks.preferencesQuery.data = [
      { category: "announcements", is_enabled: false },
    ];
    render(<ProfilePanel />);
    expect(categorySwitches()).toHaveLength(NOTIFICATION_CATEGORIES.length);
    for (const element of categorySwitches()) {
      expect(element).toHaveAttribute("data-state", "checked");
    }
  });

  it("PATCHes the toggled category against the active chapter", async () => {
    render(<ProfilePanel />);
    await userEvent.click(categorySwitch(/^billing$/i));

    await waitFor(() => {
      expect(mocks.updatePreferenceMutateAsync).toHaveBeenCalled();
    });
    expect(mocks.updatePreferenceMutateAsync.mock.calls[0]?.[0]).toEqual({
      chapter_id: "chap-1",
      category: "billing",
      is_enabled: false,
    });
  });

  // Found by mutating the card rather than by writing the test first: two
  // different corruptions of the `.catch` chain left every assertion green
  // because nothing pinned the quiet path. A toggle that works must say
  // nothing — a success toast on every switch flip is its own defect.
  it("says nothing when a toggle succeeds", async () => {
    render(<ProfilePanel />);
    await userEvent.click(categorySwitch(/^events$/i));

    await waitFor(() => {
      expect(mocks.updatePreferenceMutateAsync).toHaveBeenCalled();
    });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  // The toggle-failure affordance. The hook reverts the cache itself (#312);
  // what the card owes the member is the sentence saying why the switch moved
  // back — otherwise the revert reads as the control being broken.
  //
  // Driven by a REJECTING promise rather than by calling an `onError` callback
  // the test itself supplies. The earlier version did the latter, which only
  // proved the card passes a function with the right copy — it could not fail
  // when that function is never invoked, which is precisely the defect review
  // found here.
  it("toasts when a toggle fails, naming the category and the direction", async () => {
    mocks.updatePreferenceMutateAsync.mockRejectedValue(new Error("boom"));
    render(<ProfilePanel />);
    await userEvent.click(categorySwitch(/^tasks$/i));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalled();
    });
    const toasted = mocks.toast.mock.calls.at(-1)?.[0];
    expect(toasted.variant).toBe("destructive");
    expect(toasted.title).toMatch(/tasks/i);
    expect(toasted.title).toMatch(/off/i);
  });

  // Two failures in flight must produce two correctly named toasts.
  //
  // Scope honestly: `useUpdateNotificationPreference` is mocked wholesale here,
  // so this does NOT exercise TanStack's `MutationObserver` and cannot by
  // itself prove the supersession fix. What it pins is the half this file can
  // see — that each call gets its own handler closed over its own label, so a
  // late first failure is still reported and is not labelled with the second
  // toggle's category. The other half (that a superseded mutation's promise
  // still rejects to its own caller) is a property of query-core; pinning it
  // would need a real `QueryClientProvider` with two overlapping failing
  // PATCHes, which belongs in `packages/hooks`, not in a panel test that mocks
  // the hook away.
  it("reports both failures when two toggles are in flight at once", async () => {
    let rejectFirst!: (error: Error) => void;
    mocks.updatePreferenceMutateAsync
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockRejectedValueOnce(new Error("second"));

    render(<ProfilePanel />);
    await userEvent.click(categorySwitch(/^points$/i));
    await userEvent.click(categorySwitch(/^billing$/i));
    rejectFirst(new Error("first"));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledTimes(2);
    });
    const titles = mocks.toast.mock.calls
      .map((call) => call[0].title)
      .join("\n");
    expect(titles).toMatch(/points/i);
    expect(titles).toMatch(/billing/i);
  });

  // The branch that has no counterpart on the card above it. With no chapter
  // the query never runs, so it sits pending-and-idle forever; a loading
  // branch checked first would spin a skeleton with nothing on the way.
  // The rung's real job: without it the card falls through every branch to
  // `null` and draws six live-looking switches that the toggle handler then
  // silently drops at its own `!chapterId` guard — a dead control.
  //
  // The fixture is a genuine disabled query: `isPending: true` with
  // `isLoading: false` and `fetchStatus: "idle"`. An earlier version set
  // `isLoading: true` alongside `fetchStatus: "idle"`, which TanStack cannot
  // produce (v5 derives `isLoading = isPending && isFetching`, and a disabled
  // query never fetches) — so it "proved" a claim about the loading rung that
  // was never reachable.
  it("draws no switches at all when no chapter is active", () => {
    mocks.chapterId = null;
    mocks.preferencesQuery.data = undefined;
    mocks.preferencesQuery.isPending = true;
    mocks.preferencesQuery.isLoading = false;
    render(<ProfilePanel />);

    expect(categorySwitches()).toHaveLength(0);
    expect(
      screen.queryByText(/loading your notification settings/i),
    ).toBeNull();
  });

  it("offers a retry rather than switches when the load failed", () => {
    mocks.preferencesQuery.data = undefined;
    mocks.preferencesQuery.isError = true;
    render(<ProfilePanel />);

    expect(
      screen.getByText(/couldn't load your notification settings/i),
    ).toBeTruthy();
    expect(categorySwitches()).toHaveLength(0);
  });

  // Same rule the screen-scale block follows: TanStack keeps `data` through a
  // background refetch failure, and switches drawn from a still-held cache
  // beat a card that vanishes when a focus refetch blips.
  it("keeps the switches when a refetch fails but the cache still holds rows", () => {
    mocks.preferencesQuery.data = [{ category: "points", is_enabled: false }];
    mocks.preferencesQuery.isError = true;
    render(<ProfilePanel />);

    expect(categorySwitch(/^points$/i)).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    expect(
      screen.queryByText(/couldn't load your notification settings/i),
    ).toBeNull();
  });

  it("shows the offline state only when nothing is cached", () => {
    mockOffline.value = true;
    mocks.preferencesQuery.data = undefined;
    render(<ProfilePanel />);

    expect(
      screen.getByText(/notification settings unavailable offline/i),
    ).toBeTruthy();
    expect(categorySwitches()).toHaveLength(0);
  });

  // The "only when" half, which the test above cannot pin on its own. Review
  // proved the gap by mutation: relaxing the rung to a bare `isOffline` left
  // every test green, so a blip in `navigator.onLine` would have vanished the
  // whole card for every member holding cached rows.
  it("keeps the switches offline when rows are cached, but refuses writes", async () => {
    mockOffline.value = true;
    mocks.preferencesQuery.data = [{ category: "points", is_enabled: false }];
    render(<ProfilePanel />);

    expect(
      screen.queryByText(/notification settings unavailable offline/i),
    ).toBeNull();
    expect(categorySwitch(/^points$/i)).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    // Refused rather than optimistically accepted: an offline PATCH pauses
    // before it is sent, so accepting the toggle would move the switch, save
    // nothing, and say nothing.
    //
    // Soft-disabled, so it stays readable and reachable: the real `disabled`
    // attribute makes `switch.tsx` drop every `enabled:`-scoped state colour,
    // which flattens all six switches to one appearance and takes them out of
    // the tab order — losing the ability to *read* which categories are muted,
    // which is the more common offline need.
    const points = categorySwitch(/^points$/i);
    expect(points).toHaveAttribute("aria-disabled", "true");
    expect(points).not.toBeDisabled();
    await userEvent.click(points);
    expect(mocks.updatePreferenceMutateAsync).not.toHaveBeenCalled();
    // And it says so, rather than swallowing the click.
    expect(mocks.toast).toHaveBeenCalled();
    expect(mocks.toast.mock.calls.at(-1)?.[0].title).toMatch(/offline/i);
  });

  // `spec/ui/resilience/connection-state.md`'s queueless rule wires the reason to the control itself,
  // not to a sentence beside it. Without this a screen-reader member hears
  // "unavailable" with no explanation — and a dangling `aria-describedby` id
  // fails silently, so the reference is resolved here rather than asserted to
  // merely exist.
  it("puts the offline reason on each switch, not only under the grid", () => {
    mockOffline.value = true;
    mocks.preferencesQuery.data = [];
    render(<ProfilePanel />);

    const described = categorySwitch(/^points$/i)
      .getAttribute("aria-describedby")
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toMatch(/offline/i);
    // The category blurb must survive alongside it, not be replaced by it.
    expect(described).toMatch(/leaderboard/i);
  });

  it("drops the offline reference from the switches once back online", () => {
    mockOffline.value = false;
    mocks.preferencesQuery.data = [];
    render(<ProfilePanel />);

    expect(categorySwitch(/^points$/i).getAttribute("aria-describedby")).toBe(
      "notification-category-points-description",
    );
  });

  // The store initialises to `activeChapterId: null`, so before rehydration —
  // and in the server-rendered HTML — a member WITH a chapter is
  // indistinguishable from one without. The copy must therefore not assert
  // anything about their account; it instructs instead. Gating the rung on the
  // store's `hasHydrated` was tried and reverted (that flag can never flip when
  // `localStorage` access throws), so this phrasing is the guard.
  it("instructs rather than asserting when no chapter is active", () => {
    mocks.chapterId = null;
    render(<ProfilePanel />);

    expect(screen.getByText(/select a chapter/i)).toBeTruthy();
    expect(screen.queryByText(/no active chapter/i)).toBeNull();
    expect(screen.queryByText(/you have no chapter/i)).toBeNull();
    expect(categorySwitches()).toHaveLength(0);
  });

  // The one piece of copy that is not decorative: `announcements` is the
  // category with real traffic and no switch, so the grid would otherwise read
  // as a complete list of what can arrive.
  it("says announcements are not switchable", () => {
    render(<ProfilePanel />);
    expect(
      screen.getByText(/chapter announcements always arrive/i),
    ).toBeTruthy();
  });
});

describe("ProfilePanel — graduation year guard (#2206)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    mocks.settingsQuery.data = undefined;
  });

  const yearInput = () => screen.getByLabelText(/graduation year/i);

  it("keeps the last whole year through a negative or a decimal", () => {
    render(<ProfilePanel />);
    expectRefusedEntriesKeep(yearInput(), "2027");
  });

  it("reads an emptied or unparseable year as no year", () => {
    render(<ProfilePanel />);
    expectClearingEntriesEmpty(yearInput(), "2027");
  });

  it("saves the kept whole year, never NaN or Infinity", async () => {
    render(<ProfilePanel />);
    fireEvent.change(yearInput(), { target: { value: "2027" } });
    fireEvent.change(yearInput(), { target: { value: "1.5" } });
    await userEvent.click(
      screen.getByRole("button", { name: /save profile/i }),
    );

    await waitFor(() =>
      expect(mocks.updateUser.mutateAsync).toHaveBeenCalled(),
    );
    expect(mocks.updateUser.mutateAsync.mock.calls[0]![0].graduation_year).toBe(
      2027,
    );
  });

  it("saves a cleared year as null, so the stored one is removed", async () => {
    render(<ProfilePanel />);
    fireEvent.change(yearInput(), { target: { value: "2027" } });
    fireEvent.change(yearInput(), { target: { value: "" } });
    await userEvent.click(
      screen.getByRole("button", { name: /save profile/i }),
    );

    await waitFor(() =>
      expect(mocks.updateUser.mutateAsync).toHaveBeenCalled(),
    );
    expect(
      mocks.updateUser.mutateAsync.mock.calls[0]![0].graduation_year,
    ).toBeNull();
  });
});

describe("ProfilePanel — profile details (2026-11-06 form fixes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueries();
  });

  it("sends the major the member typed", async () => {
    render(<ProfilePanel />);

    await userEvent.type(screen.getByLabelText("Major"), "Economics");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.updateUser.mutateAsync).toHaveBeenCalled();
    });
    expect(mocks.updateUser.mutateAsync.mock.calls[0]![0]).toMatchObject({
      major: "Economics",
    });
  });

  // Paul, 2026-11-06: an undergrad has no after-graduation city or company.
  it("hides City and Company until the graduation year arrives", async () => {
    mocks.userQuery.data = { ...mocks.userQuery.data, graduation_year: 2099 };
    render(<ProfilePanel />);

    expect(screen.queryByText("After graduation")).toBeNull();
    expect(screen.queryByLabelText("City")).toBeNull();

    const year = screen.getByLabelText("Graduation year");
    await userEvent.clear(year);
    await userEvent.type(year, "2020");
    expect(screen.getByText("After graduation")).toBeTruthy();
    expect(screen.getByLabelText("City")).toBeTruthy();
  });

  it("keeps City showing for an undergrad who already has one", () => {
    mocks.userQuery.data = {
      ...mocks.userQuery.data,
      graduation_year: 2099,
      current_city: "Troy, NY",
    };
    render(<ProfilePanel />);

    expect(screen.getByDisplayValue("Troy, NY")).toBeTruthy();
  });
});
