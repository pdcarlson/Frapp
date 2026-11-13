import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";

// Shared spy so tests can assert the exact mutation payload the sheet sends.
const updateRolesMutateAsync = vi.fn().mockResolvedValue({});
const {
  correctMutateAsync,
  dmMutateAsync,
  memberByUserId,
  memberQueryState,
  mockRouterPush,
  mockToast,
  mockCurrentUserId,
  mockCurrentUserLoading,
  mockPermissions,
  mockRoles,
  refetchMember,
  removeMutateAsync,
  rolesState,
} = vi.hoisted(() => ({
  correctMutateAsync: vi.fn(),
  // What `useMemberByUserId` answers, per test.
  memberQueryState: {
    data: undefined as Record<string, unknown> | undefined,
    isPending: false,
    isError: false,
  },
  memberByUserId: vi.fn(),
  refetchMember: vi.fn(),
  removeMutateAsync: vi.fn(),
  dmMutateAsync: vi.fn(),
  mockRouterPush: vi.fn(),
  mockToast: vi.fn(),
  // Distinct from every test's member `user_id` ("u1") so the Message
  // button renders by default; self-DM cases override this.
  mockCurrentUserId: { current: "viewer-1" as string | null },
  mockCurrentUserLoading: { current: false },
  mockPermissions: { current: ["*"] as string[] },
  mockRoles: { current: [] as unknown[] | undefined },
  rolesState: { isError: false, refetch: vi.fn() },
}));

vi.mock("@repo/hooks", async () => ({
  // The pure reader of the DM response runs for real.
  dmChannelIdOf: (
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks")
  ).dmChannelIdOf,
  useMemberDisplayNames: () => ({ avatarTintFor: () => null }),
  useMemberByUserId: (userId: string) => {
    memberByUserId(userId);
    return {
      ...memberQueryState,
      isFetching: false,
      refetch: refetchMember,
    };
  },
  useRoles: () => ({
    data: mockRoles.current,
    isError: rolesState.isError,
    isPending: mockRoles.current === undefined && !rolesState.isError,
    isSuccess: mockRoles.current !== undefined,
    refetch: rolesState.refetch,
  }),
  useRemoveMember: () => ({ mutateAsync: removeMutateAsync, isPending: false }),
  useUpdateMemberRoles: () => ({
    mutateAsync: updateRolesMutateAsync,
    isPending: false,
  }),
  useCorrectMemberProfile: () => ({
    mutateAsync: correctMutateAsync,
    isPending: false,
  }),
  useGetOrCreateDm: () => ({ mutateAsync: dmMutateAsync, isPending: false }),
  useMyPermissions: () => ({ data: { permissions: mockPermissions.current } }),
  // Groups (#4076) have their own spec (`member-groups-section.spec.tsx`);
  // unloaded here, so the section draws nothing.
  useGroups: () => ({ data: undefined }),
  groupsOfMember: () => [],
  // The pledge class section (#3939) has its own spec; here it only has to
  // mount with the member's values.
  usePledgeClasses: () => ({
    data: [{ id: "alpha", name: "Alpha" }],
    isPending: false,
    isSuccess: true,
    isError: false,
  }),
  useAssignPledgeClasses: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/use-chapter-vocabulary", () => ({
  useChapterVocabulary: () => undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({
    userId: mockCurrentUserId.current,
    isLoading: mockCurrentUserLoading.current,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { MemberDetailSheet } from "./member-detail-sheet";

const baseMember = {
  id: "m1",
  user_id: "u1",
  display_name: "Jane Smith",
  email: "jane@example.com",
  has_completed_onboarding: true,
  created_at: "2026-01-15T00:00:00Z",
  role_ids: [] as string[],
  custom_role_ids: [] as string[],
};

/** The sheet as chat opens it: a user id, and the profile read answering. */
function renderProfile(
  member: Record<string, unknown> = baseMember,
  props: {
    points?: number | null;
    onOpenChange?: (open: boolean) => void;
  } = {},
) {
  memberQueryState.data = member;
  return render(
    <MemberDetailSheet
      open
      onOpenChange={props.onOpenChange ?? (() => {})}
      userId={typeof member.user_id === "string" ? member.user_id : null}
      points={props.points}
    />,
  );
}

function openRoleEditor() {
  fireEvent.click(
    screen.getByRole("button", { name: "Edit Jane Smith's roles" }),
  );
}

beforeEach(() => {
  memberQueryState.data = undefined;
  memberQueryState.isPending = false;
  memberQueryState.isError = false;
  memberByUserId.mockClear();
  refetchMember.mockReset();
  updateRolesMutateAsync.mockClear();
  mockPermissions.current = ["*"];
  mockRoles.current = [];
  rolesState.isError = false;
  rolesState.refetch.mockReset();
  mockCurrentUserId.current = "viewer-1";
  mockCurrentUserLoading.current = false;
});

describe("MemberDetailSheet loads by user id (#3726)", () => {
  it("reads the profile by the user id it was opened with", () => {
    renderProfile();
    expect(memberByUserId).toHaveBeenCalledWith("u1");
    expect(
      screen.getByRole("heading", { name: "Jane Smith" }),
    ).toBeInTheDocument();
  });

  it("draws the directory row it was opened from while the read is in flight", () => {
    memberQueryState.isPending = true;
    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        userId="u1"
        initialMember={baseMember}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Jane Smith" }),
    ).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it("names the member from the opener's roster while the read is in flight, not by their id", () => {
    memberQueryState.isPending = true;
    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        userId="u1"
        identity={{ name: "Jane Smith", avatarUrl: null }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Jane Smith" }),
    ).toBeInTheDocument();
  });

  it("ignores a seed row that belongs to someone else", () => {
    memberQueryState.isPending = true;
    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        userId="u2"
        initialMember={baseMember}
      />,
    );
    expect(screen.queryByText("jane@example.com")).not.toBeInTheDocument();
  });

  it("draws a skeleton and one screen-reader status line while nothing is in hand (components.md §10)", () => {
    memberQueryState.isPending = true;
    render(<MemberDetailSheet open onOpenChange={() => {}} userId="u1" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading member profile");
    expect(status).toHaveClass("sr-only");
  });

  it("offers a retry when the read fails with nothing cached", () => {
    memberQueryState.isError = true;
    render(<MemberDetailSheet open onOpenChange={() => {}} userId="u1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load this member's profile.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMember).toHaveBeenCalled();
  });
});

describe("MemberDetailSheet layout follows mobile's order", () => {
  it("draws photo, name, class year, Message, phone, email, member since, roles, then More details and bio", () => {
    mockRoles.current = [
      { id: "r-member", name: "Member", color: null, display_order: 9 },
      { id: "r-pres", name: "President", color: "#F2994A", display_order: 1 },
    ];
    renderProfile({
      ...baseMember,
      graduation_year: 2027,
      major: "Economics",
      phone: "(518) 555-0142",
      bio: "Loves a good algorithm.",
      role_ids: ["r-member", "r-pres"],
      custom_fields: [
        {
          field_id: "f1",
          label: "Hometown",
          type: "text",
          visibility: "chapter",
          value: "Boston",
        },
      ],
    });

    const sequence = [
      screen.getByRole("heading", { name: "Jane Smith" }),
      screen.getByText("Economics · '27"),
      screen.getByRole("button", { name: /Message/ }),
      screen.getByText("(518) 555-0142"),
      screen.getByText("jane@example.com"),
      screen.getByText("Member since"),
      screen.getByText("Roles"),
      screen.getByRole("button", { name: "More details" }),
      screen.getByText("Loves a good algorithm."),
    ];
    for (let i = 1; i < sequence.length; i += 1) {
      expect(
        sequence[i - 1]!.compareDocumentPosition(sequence[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("draws roles as chips in the chapter's rank, each with its color", () => {
    mockRoles.current = [
      { id: "r-member", name: "Member", color: null, display_order: 9 },
      { id: "r-pres", name: "President", color: "#F2994A", display_order: 1 },
    ];
    renderProfile({
      ...baseMember,
      role_ids: ["r-member", "r-pres"],
    });

    const chips = within(
      screen.getByRole("region", { name: "Roles" }),
    ).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "President",
      "Member",
    ]);
    const dot = chips[0]!.querySelector("span");
    expect(dot).toHaveStyle({ backgroundColor: "#F2994A" });
  });

  it("says the roles failed to load, with a retry, rather than claiming none", () => {
    mockRoles.current = undefined;
    rolesState.isError = true;
    renderProfile({ ...baseMember, role_ids: ["r-pres"] });
    expect(screen.queryByText("No roles")).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load roles.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(rolesState.refetch).toHaveBeenCalled();
  });

  it("says so when the member holds no role", () => {
    renderProfile();
    expect(screen.getByText("No roles")).toBeInTheDocument();
  });

  it("links the email", () => {
    renderProfile();
    expect(
      screen.getByRole("link", { name: "jane@example.com" }),
    ).toHaveAttribute("href", "mailto:jane@example.com");
  });

  it("draws points only where the opener has them", () => {
    const { unmount } = renderProfile(baseMember, { points: 142 });
    expect(screen.getByText("142")).toBeInTheDocument();
    unmount();
    renderProfile();
    expect(screen.queryByText("Points")).not.toBeInTheDocument();
  });

  it("flags an unfinished onboarding, and says nothing about a finished one", () => {
    const { unmount } = renderProfile({
      ...baseMember,
      has_completed_onboarding: false,
    });
    expect(screen.getByText("Pending")).toBeInTheDocument();
    unmount();
    renderProfile();
    expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
  });
});

describe("MemberDetailSheet pledge class (#3939)", () => {
  beforeEach(() => {
    mockPermissions.current = ["members:view"];
  });
  afterEach(() => {
    mockPermissions.current = ["*"];
  });

  it("shows the member's class and order number under the roles", () => {
    renderProfile({
      ...baseMember,
      pledge_class_id: "alpha",
      order_number: 12,
    });
    const section = screen.getByRole("region", {
      name: "Pledge class · Fraternal order",
    });
    expect(within(section).getByText("Alpha")).toBeInTheDocument();
    expect(within(section).getByText("12")).toBeInTheDocument();
  });

  it("draws no section for a member with neither", () => {
    renderProfile();
    expect(
      screen.queryByRole("region", { name: "Pledge class · Fraternal order" }),
    ).toBeNull();
  });

  it("gives Edit to a roles:manage holder, and to nobody else", () => {
    mockPermissions.current = ["members:view", "roles:manage"];
    renderProfile();
    expect(
      screen.getByRole("button", { name: "Edit Jane Smith's Pledge class" }),
    ).toBeInTheDocument();
  });

  it("holds Edit back until the profile read answers, so a stale row can't seed it", () => {
    mockPermissions.current = ["members:view", "roles:manage"];
    memberQueryState.data = undefined;
    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        userId="u1"
        initialMember={{ ...baseMember, pledge_class_id: "alpha" }}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Jane Smith's Pledge class" }),
    ).toBeNull();
  });
});

describe("MemberDetailSheet custom fields", () => {
  it("renders server-provided custom fields with typed value formatting", () => {
    renderProfile({
      ...baseMember,
      custom_fields: [
        {
          field_id: "f1",
          key: "major",
          label: "Major",
          type: "text",
          visibility: "chapter",
          value: "Computer Science",
        },
        {
          field_id: "f2",
          key: "hometown",
          label: "Hometown",
          type: "text",
          visibility: "chapter",
          value: null,
        },
        {
          field_id: "f3",
          key: "dues_paid",
          label: "Dues Paid",
          type: "boolean",
          visibility: "exec",
          value: "true",
        },
      ],
    });

    // Folded until asked for (#3711): logistics aren't why a profile opens.
    expect(screen.queryByText("Computer Science")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "More details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Dues Paid")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    // An unset value says so in a word, never a lone em dash: board `1t` lists
    // "em dashes in UI copy" under gone.
    // Scoped to the row: an officer's unset pledge class reads "Not set" too.
    expect(
      within(screen.getByText("Hometown").parentElement!).getByText("Not set"),
    ).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("omits the custom-fields section when the server returns none", () => {
    renderProfile({ ...baseMember, custom_fields: [] });
    expect(
      screen.queryByRole("button", { name: "More details" }),
    ).not.toBeInTheDocument();
  });
});

describe("MemberDetailSheet heading", () => {
  it("names an unnamed member exactly as the directory row that opened it does", () => {
    // #2422: the row reads `Member <first six of id>` via `memberLabel`, so the
    // sheet opened from it must too, not a second spelling of the same person.
    renderProfile({
      ...baseMember,
      user_id: "2f4a1c9d-0000-4000-8000-000000000000",
      display_name: "   ",
    });

    expect(
      screen.getByRole("heading", { name: "Member 2f4a1c" }),
    ).toBeInTheDocument();
  });
});

describe("MemberDetailSheet role editor", () => {
  it("offers Edit only to a viewer holding roles:manage", () => {
    mockPermissions.current = ["members:view"];
    const { unmount } = renderProfile();
    expect(
      screen.queryByRole("button", { name: "Edit Jane Smith's roles" }),
    ).not.toBeInTheDocument();
    unmount();

    mockPermissions.current = ["members:view", "roles:manage"];
    renderProfile();
    expect(
      screen.getByRole("button", { name: "Edit Jane Smith's roles" }),
    ).toBeInTheDocument();
  });

  it("doesn't offer Edit before the roles list loads (#3670)", () => {
    mockRoles.current = undefined;
    renderProfile();
    expect(
      screen.queryByRole("button", { name: "Edit Jane Smith's roles" }),
    ).not.toBeInTheDocument();
  });

  it("opens the checklists with the member's roles pre-checked, and Cancel puts the chips back", () => {
    mockRoles.current = [
      { id: "r-member", name: "Member", permissions: ["members:view"] },
      { id: "r-cabinet", name: "Cabinet", permissions: [] },
    ];
    renderProfile({ ...baseMember, role_ids: ["r-member"] });
    openRoleEditor();

    const checkbox = (name: string) =>
      screen
        .getByText(name, { selector: "p" })
        .closest("label")!
        .querySelector("input")!;
    expect(checkbox("Member").checked).toBe(true);
    expect(checkbox("Cabinet").checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Jane Smith's roles" }),
    ).toBeInTheDocument();
  });

  it("locks a role holding *, President or legacy, as mobile does (#4164)", () => {
    mockRoles.current = [
      { id: "r-member", name: "Member", permissions: ["members:view"] },
      {
        id: "r-pres",
        name: "President",
        is_system: true,
        system_key: "PRESIDENT",
        permissions: ["*"],
      },
      {
        id: "r-legacy",
        name: "Old Admin",
        is_system: false,
        permissions: ["*"],
      },
    ];
    renderProfile({ ...baseMember, role_ids: ["r-member", "r-pres"] });
    openRoleEditor();

    const checkbox = (name: string) =>
      screen
        .getByText(name, { selector: "p" })
        .closest("label")!
        .querySelector("input")!;
    expect(checkbox("Member").disabled).toBe(false);
    expect(checkbox("President").disabled).toBe(true);
    expect(checkbox("President").checked).toBe(true);
    expect(checkbox("Old Admin").disabled).toBe(true);
    expect(
      screen.getAllByText("Changes with Transfer presidency"),
    ).toHaveLength(2);
  });

  it("drops the editor and its unsaved picks when the sheet closes", () => {
    mockRoles.current = [{ id: "r-member", name: "Member", permissions: [] }];
    memberQueryState.data = { ...baseMember, role_ids: ["r-member"] };
    const { rerender } = render(
      <MemberDetailSheet open onOpenChange={() => {}} userId="u1" />,
    );
    openRoleEditor();
    fireEvent.click(
      screen
        .getByText("Member", { selector: "p" })
        .closest("label")!
        .querySelector("input")!,
    );

    rerender(
      <MemberDetailSheet open={false} onOpenChange={() => {}} userId="u1" />,
    );
    rerender(<MemberDetailSheet open onOpenChange={() => {}} userId="u1" />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    openRoleEditor();
    expect(
      screen
        .getByText("Member", { selector: "p" })
        .closest("label")!
        .querySelector("input")!.checked,
    ).toBe(true);
  });
});

describe("MemberDetailSheet save payload", () => {
  it("sends the selection as-is, including ids of since-deleted roles", async () => {
    mockRoles.current = [{ id: "r-cabinet", name: "Cabinet", permissions: [] }];
    // r-deleted no longer exists in the chapter's roles. It is still sent
    // (the server exempts held ids): filtering against the possibly-stale
    // list would silently strip roles the officer never touched.
    renderProfile({ ...baseMember, role_ids: ["r-deleted"] });
    openRoleEditor();

    fireEvent.click(
      screen
        .getByText("Cabinet", { selector: "p" })
        .closest("label")!
        .querySelector("input")!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() =>
      expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1),
    );
    // Never custom_role_ids: custom roles are ordinary roles now (#4075).
    expect(updateRolesMutateAsync).toHaveBeenCalledWith({
      id: "m1",
      role_ids: ["r-deleted", "r-cabinet"],
    });
  });

  it("closes the editor once the save lands", async () => {
    renderProfile();
    openRoleEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Jane Smith's roles" }),
      ).toBeInTheDocument(),
    );
  });
});

// #3670: taking away the last role with member access locks the member out of
// chat, the roster and events, so the save asks first.
describe("MemberDetailSheet member-access warning", () => {
  beforeEach(() => {
    mockRoles.current = [
      { id: "r-member", name: "Member", permissions: ["members:view"] },
      {
        id: "r-cabinet",
        name: "Cabinet",
        permissions: ["channels:read:cabinet"],
      },
    ];
  });

  afterEach(() => {
    mockRoles.current = [];
  });

  function renderHolding(roleIds: string[]) {
    renderProfile({ ...baseMember, role_ids: roleIds });
    openRoleEditor();
  }

  function untick(name: string) {
    const row = screen.getByText(name, { selector: "p" }).closest("label");
    fireEvent.click(row!.querySelector("input")!);
  }

  it("asks before saving away the last role with member access, and saves nothing on Cancel", async () => {
    renderHolding(["r-member", "r-cabinet"]);
    untick("Member");
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    // The confirmation's own Cancel, not the editor's in the sheet footer.
    const title = await screen.findByText("Take away Jane Smith's access?");
    const dialog = title.closest<HTMLElement>('[role="dialog"]')!;
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Take away Jane Smith's access?"),
      ).not.toBeInTheDocument(),
    );
    expect(updateRolesMutateAsync).not.toHaveBeenCalled();
  });

  it("saves once the officer confirms", async () => {
    renderHolding(["r-member", "r-cabinet"]);
    untick("Member");
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Take away access" }),
    );

    await waitFor(() =>
      expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(updateRolesMutateAsync).toHaveBeenCalledWith({
      id: "m1",
      role_ids: ["r-cabinet"],
    });
  });

  it("saves without asking when the member keeps access", async () => {
    renderHolding(["r-member", "r-cabinet"]);
    untick("Cabinet");
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() =>
      expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.queryByText("Take away Jane Smith's access?"),
    ).not.toBeInTheDocument();
  });
});

describe("MemberDetailSheet Message action", () => {
  beforeEach(() => {
    dmMutateAsync.mockReset();
    mockRouterPush.mockReset();
    mockToast.mockReset();
  });

  it("creates or reuses the DM and navigates to it with the channel selected", async () => {
    dmMutateAsync.mockResolvedValue({ id: "dm-channel-1" });
    renderProfile();

    fireEvent.click(screen.getByRole("button", { name: /message/i }));

    await waitFor(() =>
      expect(dmMutateAsync).toHaveBeenCalledWith({ member_id: "u1" }),
    );
    expect(mockRouterPush).toHaveBeenCalledWith("/chat?channel=dm-channel-1");
  });

  it("toasts an error rather than navigating when the DM call fails", async () => {
    dmMutateAsync.mockRejectedValue(new Error("network down"));
    renderProfile();

    fireEvent.click(screen.getByRole("button", { name: /message/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not start conversation",
          description: "Something went wrong. Please retry.",
          variant: "destructive",
        }),
      ),
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // Self-DM is not rejected server-side (member_ids: [callerId, callerId] still
  // passes the "exactly 2" check), so the guard has to be here.
  it("hides the Message action on the viewer's own profile", () => {
    mockCurrentUserId.current = "u1";
    renderProfile();
    expect(
      screen.queryByRole("button", { name: /message/i }),
    ).not.toBeInTheDocument();
  });

  // `useFrappUser()` reports `userId: null` until /v1/users/me resolves, so
  // comparing against that null would let a self-DM through for as long as
  // the load takes.
  it("hides the Message action while the viewer's own id is still loading", () => {
    mockCurrentUserId.current = null;
    mockCurrentUserLoading.current = true;
    renderProfile();
    expect(
      screen.queryByRole("button", { name: /message/i }),
    ).not.toBeInTheDocument();
  });

  // The sheet stays mounted and swaps members as names and rows are clicked,
  // so a slow DM request started for one member can resolve after the sheet
  // has moved to another. That stale continuation must not navigate.
  it("ignores a DM result that resolves after the sheet has moved to a different member", async () => {
    let resolveDm!: (value: unknown) => void;
    dmMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDm = resolve;
        }),
    );

    const onOpenChange = vi.fn();
    const { rerender } = renderProfile(baseMember, { onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: /message/i }));
    await waitFor(() =>
      expect(dmMutateAsync).toHaveBeenCalledWith({ member_id: "u1" }),
    );

    memberQueryState.data = { ...baseMember, id: "m2", user_id: "u2" };
    rerender(
      <MemberDetailSheet open onOpenChange={onOpenChange} userId="u2" />,
    );

    await act(async () => {
      resolveDm({ id: "dm-channel-1" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToast).not.toHaveBeenCalled();
  });
});

// Removing a member sits behind the profile's ⋯, never on its face (Paul,
// 2026-11-11), and only where the API says this viewer may remove this member
// (`viewer_can_remove`: `members:remove`, not their own profile, and the
// member ranks below them).
describe("MemberDetailSheet Remove from chapter", () => {
  const moreButton = () =>
    screen.queryByRole("button", { name: "More for Jane Smith" });

  it("draws no Remove button on the profile's face", () => {
    renderProfile({ ...baseMember, viewer_can_remove: true });
    expect(
      screen.queryByRole("button", { name: /Remove/ }),
    ).not.toBeInTheDocument();
  });

  it("draws no ⋯ when the API says this viewer may not remove them", () => {
    renderProfile({ ...baseMember, viewer_can_remove: false });
    expect(moreButton()).not.toBeInTheDocument();
  });

  it("draws no ⋯ for a profile read that says nothing about removal", () => {
    renderProfile();
    expect(moreButton()).not.toBeInTheDocument();
  });

  it("never offers it on your own profile", () => {
    mockCurrentUserId.current = "u1";
    renderProfile({ ...baseMember, viewer_can_remove: true });
    expect(moreButton()).not.toBeInTheDocument();
  });

  it("removes from the ⋯ menu after confirming", async () => {
    const user = userEvent.setup();
    removeMutateAsync.mockResolvedValue({});
    const onOpenChange = vi.fn();
    renderProfile({ ...baseMember, viewer_can_remove: true }, { onOpenChange });

    await user.click(moreButton()!);
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove from chapter" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Remove Jane Smith from the chapter?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Remove from chapter" }),
    );

    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalledWith("m1"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    removeMutateAsync.mockReset();
    renderProfile({ ...baseMember, viewer_can_remove: true });

    await user.click(moreButton()!);
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove from chapter" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Remove Jane Smith from the chapter?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(removeMutateAsync).not.toHaveBeenCalled();
  });
});

// #3711: the member's own phone, a tap away.
describe("MemberDetailSheet phone", () => {
  it("links the phone to a call", () => {
    renderProfile({ ...baseMember, phone: "+1 (518) 555-0142" });
    expect(
      screen.getByRole("link", { name: "+1 (518) 555-0142" }),
    ).toHaveAttribute("href", "tel:+15185550142");
  });

  it("offers to text the same number", () => {
    renderProfile({ ...baseMember, phone: "+1 (518) 555-0142" });
    expect(
      screen.getByRole("link", { name: "Text Jane Smith" }),
    ).toHaveAttribute("href", "sms:+15185550142");
  });

  it("draws no Phone row when the member hasn't set one", () => {
    renderProfile({ ...baseMember, phone: null });
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
  });
});

// #4367: an officer fixes a member's name and graduation year from the ⋯,
// only where the API says `viewer_can_edit_profile`.
describe("MemberDetailSheet Edit name and graduation year", () => {
  const moreButton = () =>
    screen.queryByRole("button", { name: "More for Jane Smith" });

  it("draws no ⋯ when the API says nothing about it", () => {
    renderProfile({ ...baseMember, viewer_can_edit_profile: false });
    expect(moreButton()).not.toBeInTheDocument();
  });

  it("never offers it on your own profile", () => {
    mockCurrentUserId.current = "u1";
    renderProfile({ ...baseMember, viewer_can_edit_profile: true });
    expect(moreButton()).not.toBeInTheDocument();
  });

  it("offers only the edit when removal isn't allowed", async () => {
    const user = userEvent.setup();
    renderProfile({ ...baseMember, viewer_can_edit_profile: true });
    await user.click(moreButton()!);
    expect(
      await screen.findByRole("menuitem", {
        name: "Edit name and graduation year",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Remove from chapter" }),
    ).not.toBeInTheDocument();
  });

  it("saves only what changed", async () => {
    const user = userEvent.setup();
    correctMutateAsync.mockReset().mockResolvedValue({});
    renderProfile({
      ...baseMember,
      graduation_year: 2026,
      viewer_can_edit_profile: true,
    });
    await user.click(moreButton()!);
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Edit name and graduation year",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Jane Smith's profile",
    });
    const year = within(dialog).getByLabelText("Graduation year");
    await user.clear(year);
    await user.type(year, "2027");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(correctMutateAsync).toHaveBeenCalledWith({
        id: "m1",
        graduation_year: 2027,
      }),
    );
  });

  it("opens a member with no name on a blank field, not their label", async () => {
    const user = userEvent.setup();
    renderProfile({
      ...baseMember,
      display_name: "",
      viewer_can_edit_profile: true,
    });
    await user.click(
      await screen.findByRole("button", { name: /^More for Member / }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Edit name and graduation year",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /^Edit Member .*'s profile$/,
    });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
  });

  it("refuses a blank name before sending", async () => {
    const user = userEvent.setup();
    correctMutateAsync.mockReset();
    renderProfile({ ...baseMember, viewer_can_edit_profile: true });
    await user.click(moreButton()!);
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Edit name and graduation year",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Jane Smith's profile",
    });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter their name.",
    );
    expect(correctMutateAsync).not.toHaveBeenCalled();
  });
});

describe("MemberDetailSheet docked in the Directory (2026-11-12)", () => {
  it("opens in place of the directory, named by the member, with a back arrow", () => {
    memberQueryState.data = baseMember;
    const onOpenChange = vi.fn();
    render(
      <div data-tool-column="">
        <div data-tool-page="">
          <button type="button">Trevor row</button>
        </div>
        <MemberDetailSheet
          open
          onOpenChange={onOpenChange}
          userId="u1"
          docked
          backLabel="Back to directory"
        />
      </div>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    const region = screen.getByRole("region", { name: "Jane Smith" });
    expect(region.parentElement).toHaveAttribute("data-tool-column");
    expect(screen.getAllByRole("heading", { name: "Jane Smith" })).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to directory" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
