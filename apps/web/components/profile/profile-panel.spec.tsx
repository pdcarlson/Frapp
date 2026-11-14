import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Every mocked hook must return a STABLE reference. The panel's effect depends
// on `userQuery.data`, so a fresh object per render loops
// forever ("Maximum update depth exceeded") — a test artifact, not a bug.
const { mockOffline } = vi.hoisted(() => ({ mockOffline: { value: false } }));

const mocks = vi.hoisted(() => {
  return {
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
    stats: {
      points: 1240 as number | null,
      serviceHours: "18.5" as string | null,
      hasChapter: true,
      visible: true,
      pointsFailed: false,
      serviceFailed: false,
    },
    permissions: ["members:view"] as string[],
    memberByUserId: vi.fn<(userId: string) => { data: unknown }>(() => ({
      data: undefined,
    })),
    classSection: vi.fn<(props: Record<string, unknown>) => null>(() => null),
    updateUser: {
      mutateAsync: vi.fn<(body: Record<string, unknown>) => Promise<unknown>>(
        () => Promise.resolve({}),
      ),
      isPending: false,
    },
  };
});

// The photo control has its own spec (`profile-photo-control.spec.tsx`), though it
// records its props: whether the panel disables it offline is the panel's job.
vi.mock("@/components/profile/profile-photo-control", () => ({
  ProfilePhotoControl: (props: { hasPhoto: boolean; disabled?: boolean }) =>
    mocks.photoControl(props),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    profileIdentityLine: actual.profileIdentityLine,
    profileStatsErrorNote: actual.profileStatsErrorNote,
    useMemberDisplayNames: () => ({ avatarTintFor: () => null }),
    useCurrentUser: () => mocks.userQuery,
    useUpdateUser: () => mocks.updateUser,
    useMyProfileStats: () => mocks.stats,
    usePermissionList: () => mocks.permissions,
    useMemberByUserId: (userId: string) => mocks.memberByUserId(userId),
  };
});

// The class rows are `MemberPledgeClassSection`'s own spec's business; the
// panel's job is what it hands them.
vi.mock("@/components/members/member-pledge-class-section", () => ({
  MemberPledgeClassSection: (props: Record<string, unknown>) =>
    mocks.classSection(props),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

import { networkMock } from "@/tests/network";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";
import { cardFilledContainers } from "@/tests/card-surfaces";
import { ProfilePanel } from "./profile-panel";

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
     * `data`, so the member keeps their screen and their draft; only a pause
     * with nothing cached is a state worth rendering.
     */
    mockOffline.value = true;
    mocks.userQuery.fetchStatus = "paused";
    render(<ProfilePanel />);

    expect(screen.getByLabelText("Name")).toHaveValue("Member");
    expect(
      screen.queryByText(/your profile is unavailable offline/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/loading your profile/i)).not.toBeInTheDocument();
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
     * the draft with it — when a window-focus refetch failed. On a screen
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

describe("ProfilePanel — graduation year guard (#2206)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQueries();
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

  // #3711: the member's own phone, checked on Save, not per keystroke.
  it("sends the phone the member typed", async () => {
    render(<ProfilePanel />);

    await userEvent.type(screen.getByLabelText("Phone"), "(518) 555-0142");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.updateUser.mutateAsync).toHaveBeenCalled();
    });
    expect(mocks.updateUser.mutateAsync.mock.calls[0]![0]).toMatchObject({
      phone: "(518) 555-0142",
    });
  });

  it("keeps a stored birthday and sends who can see it (#4959)", async () => {
    mocks.userQuery.data = {
      ...mocks.userQuery.data,
      birthday_month: 3,
      birthday_day: 4,
      birthday_year: 2004,
      birthday_visibility: "nobody",
    } as typeof mocks.userQuery.data;
    render(<ProfilePanel />);

    await userEvent.click(screen.getByRole("radio", { name: "Your chapter" }));
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(mocks.updateUser.mutateAsync).toHaveBeenCalled();
    });
    expect(mocks.updateUser.mutateAsync.mock.calls[0]![0]).toMatchObject({
      birthday_month: 3,
      birthday_day: 4,
      birthday_year: 2004,
      birthday_visibility: "chapter",
    });
  });

  it("refuses a birth year with no month and day (#4959)", async () => {
    render(<ProfilePanel />);

    await userEvent.type(screen.getByLabelText("Year (optional)"), "2004");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pick a month and a day",
    );
    expect(mocks.updateUser.mutateAsync).not.toHaveBeenCalled();
  });

  it("puts a year without February 29 on the year, not the day (#4959)", async () => {
    mocks.userQuery.data = {
      ...mocks.userQuery.data,
      birthday_month: 2,
      birthday_day: 29,
      birthday_year: null,
      birthday_visibility: "nobody",
    } as typeof mocks.userQuery.data;
    render(<ProfilePanel />);

    const year = screen.getByLabelText("Year (optional)");
    await userEvent.type(year, "2003");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That year has no February 29.",
    );
    expect(year).toHaveAttribute("aria-invalid", "true");
    expect(mocks.updateUser.mutateAsync).not.toHaveBeenCalled();
  });

  it("refuses something that isn't a phone number, and says so", async () => {
    render(<ProfilePanel />);

    await userEvent.type(screen.getByLabelText("Phone"), "call me");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a phone number");
    expect(mocks.updateUser.mutateAsync).not.toHaveBeenCalled();
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

describe("ProfilePanel — what the phone's Profile shows (#4137)", () => {
  beforeEach(() => {
    resetQueries();
    mocks.stats.points = 1240;
    mocks.stats.serviceHours = "18.5";
    mocks.stats.pointsFailed = false;
    mocks.stats.serviceFailed = false;
    mocks.stats.hasChapter = true;
    mocks.stats.visible = true;
    mocks.permissions = ["members:view"];
    mocks.memberByUserId.mockClear();
    mocks.classSection.mockClear();
  });

  it("shows your points and approved service hours", () => {
    render(<ProfilePanel />);
    expect(screen.getByText("Points").nextElementSibling).toHaveTextContent(
      "1,240",
    );
    expect(
      screen.getByText("Service hours").nextElementSibling,
    ).toHaveTextContent("18.5");
  });

  it("draws a dash, not a zero, for a number not read yet, and says which read failed", () => {
    mocks.stats.points = null;
    mocks.stats.serviceHours = null;
    mocks.stats.serviceFailed = true;
    render(<ProfilePanel />);
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(
      screen.getByText("Service hours couldn't load just now."),
    ).toBeInTheDocument();
  });

  it("puts major · company · year under the name, from what is saved", () => {
    mocks.userQuery.data = {
      id: "u-1",
      email: "member@example.com",
      display_name: "Member",
      major: "Economics",
      current_company: "Acme",
      graduation_year: 2027,
    };
    render(<ProfilePanel />);
    expect(screen.getByText("Economics · Acme · '27")).toBeInTheDocument();
  });

  it("keeps that line on what is saved while you type", async () => {
    mocks.userQuery.data = {
      id: "u-1",
      email: "member@example.com",
      display_name: "Member",
      major: "Economics",
      graduation_year: 2027,
    };
    render(<ProfilePanel />);
    const major = screen.getByLabelText("Major");
    await userEvent.clear(major);
    await userEvent.type(major, "History");
    expect(screen.getByText("Economics · '27")).toBeInTheDocument();
    expect(screen.queryByText("History · '27")).toBeNull();
  });

  it("says to choose a chapter when there is none to read points in", () => {
    mocks.stats.hasChapter = false;
    mocks.stats.points = null;
    mocks.stats.serviceHours = null;
    render(<ProfilePanel />);
    expect(
      screen.getByText("Choose a chapter to see your points."),
    ).toBeInTheDocument();
  });

  it("leaves the numbers out for a role that can't read them", () => {
    mocks.stats.visible = false;
    render(<ProfilePanel />);
    expect(screen.queryByText("Points")).toBeNull();
    expect(screen.queryByText("Service hours")).toBeNull();
  });

  it("hands your class and number to read-only rows", () => {
    mocks.memberByUserId.mockReturnValue({
      data: { id: "m-1", pledge_class_id: "pc-1", order_number: 41 },
    });
    render(<ProfilePanel />);
    expect(mocks.memberByUserId).toHaveBeenCalledWith("u-1");
    expect(mocks.classSection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        memberId: "m-1",
        pledgeClassId: "pc-1",
        orderNumber: 41,
        canEdit: false,
      }),
    );
  });

  it("doesn't read your membership without the Directory's permission", () => {
    mocks.permissions = [];
    render(<ProfilePanel />);
    expect(mocks.memberByUserId).not.toHaveBeenCalledWith("u-1");
  });
});
