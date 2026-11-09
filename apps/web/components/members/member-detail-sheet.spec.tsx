import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared spy so tests can assert the exact mutation payload the sheet sends.
const updateRolesMutateAsync = vi.fn().mockResolvedValue({});
const {
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
} = vi.hoisted(() => ({
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
}));

// Custom-role assignment (bridge model): the list read is stubbed per-test via
// this holder; default mirrors "no custom roles defined".
const customRolesState: {
  data: unknown;
  isSuccess: boolean;
  isError: boolean;
  isPending: boolean;
} = { data: [], isSuccess: true, isError: false, isPending: false };

vi.mock("@repo/hooks", () => ({
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
    isError: false,
    isPending: mockRoles.current === undefined,
    isSuccess: mockRoles.current !== undefined,
  }),
  useRemoveMember: () => ({ mutateAsync: removeMutateAsync, isPending: false }),
  useUpdateMemberRoles: () => ({ mutateAsync: updateRolesMutateAsync, isPending: false }),
  useGetOrCreateDm: () => ({ mutateAsync: dmMutateAsync, isPending: false }),
  useMyPermissions: () => ({ data: { permissions: mockPermissions.current } }),
  useCustomRoles: () => customRolesState,
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
  props: { points?: number | null; onOpenChange?: (open: boolean) => void } = {},
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
  fireEvent.click(screen.getByRole("button", { name: "Edit Jane Smith's roles" }));
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
  mockCurrentUserId.current = "viewer-1";
  mockCurrentUserLoading.current = false;
  customRolesState.data = [];
  customRolesState.isSuccess = true;
  customRolesState.isError = false;
  customRolesState.isPending = false;
});

describe("MemberDetailSheet loads by user id (#3726)", () => {
  it("reads the profile by the user id it was opened with", () => {
    renderProfile();
    expect(memberByUserId).toHaveBeenCalledWith("u1");
    expect(screen.getByRole("heading", { name: "Jane Smith" })).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Jane Smith" })).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
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
  it("draws photo, name, class year, Message, roles, email, member since, then custom fields and bio", () => {
    mockRoles.current = [
      { id: "r-member", name: "Member", color: null, display_order: 9 },
      { id: "r-pres", name: "President", color: "#F2994A", display_order: 1 },
    ];
    renderProfile({
      ...baseMember,
      graduation_year: 2027,
      major: "Economics",
      bio: "Loves a good algorithm.",
      role_ids: ["r-member", "r-pres"],
      custom_fields: [
        { field_id: "f1", label: "Hometown", type: "text", visibility: "chapter", value: "Boston" },
      ],
    });

    const sequence = [
      screen.getByRole("heading", { name: "Jane Smith" }),
      screen.getByText("Economics · '27"),
      screen.getByRole("button", { name: /Message/ }),
      screen.getByText("Roles"),
      screen.getByText("jane@example.com"),
      screen.getByText("Member since"),
      screen.getByText("Custom fields"),
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
    customRolesState.data = [{ id: "cr1", key: "historian", label: "Historian" }];
    renderProfile({
      ...baseMember,
      role_ids: ["r-member", "r-pres"],
      custom_role_ids: ["cr1"],
    });

    const chips = within(
      screen.getByRole("region", { name: "Roles" }),
    ).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "President",
      "Member",
      "Historian",
    ]);
    const dot = chips[0]!.querySelector("span");
    expect(dot).toHaveStyle({ backgroundColor: "#F2994A" });
  });

  it("says so when the member holds no role", () => {
    renderProfile();
    expect(screen.getByText("No roles yet")).toBeInTheDocument();
  });

  it("links the email", () => {
    renderProfile();
    expect(screen.getByRole("link", { name: "jane@example.com" })).toHaveAttribute(
      "href",
      "mailto:jane@example.com",
    );
  });

  it("draws points only where the opener has them", () => {
    const { unmount } = renderProfile(baseMember, { points: 142 });
    expect(screen.getByText("142")).toBeInTheDocument();
    unmount();
    renderProfile();
    expect(screen.queryByText("Points")).not.toBeInTheDocument();
  });

  it("flags an unfinished onboarding, and says nothing about a finished one", () => {
    const { unmount } = renderProfile({ ...baseMember, has_completed_onboarding: false });
    expect(screen.getByText("Pending")).toBeInTheDocument();
    unmount();
    renderProfile();
    expect(screen.queryByText("Onboarding")).not.toBeInTheDocument();
  });
});

describe("MemberDetailSheet custom fields", () => {
  it("renders server-provided custom fields with typed value formatting", () => {
    renderProfile({
      ...baseMember,
      custom_fields: [
        { field_id: "f1", key: "major", label: "Major", type: "text", visibility: "chapter", value: "Computer Science" },
        { field_id: "f2", key: "hometown", label: "Hometown", type: "text", visibility: "chapter", value: null },
        { field_id: "f3", key: "dues_paid", label: "Dues Paid", type: "boolean", visibility: "exec", value: "true" },
      ],
    });

    expect(screen.getByText("Custom fields")).toBeInTheDocument();
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Dues Paid")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    // An unset value says so in a word, never a lone em dash: board `1t` lists
    // "em dashes in UI copy" under gone.
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("omits the custom-fields section when the server returns none", () => {
    renderProfile({ ...baseMember, custom_fields: [] });
    expect(screen.queryByText("Custom fields")).not.toBeInTheDocument();
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
    customRolesState.data = [
      { id: "cr1", key: "historian", label: "Historian", rank: 5, capabilities: [], core: false },
      { id: "cr2", key: "social_chair", label: "Social Chair", rank: 6, capabilities: [], core: false },
    ];
    renderProfile({ ...baseMember, role_ids: ["r-member"], custom_role_ids: ["cr1"] });
    openRoleEditor();

    const checkbox = (name: string) =>
      screen.getByText(name, { selector: "p" }).closest("label")!.querySelector("input")!;
    expect(checkbox("Member").checked).toBe(true);
    expect(checkbox("Cabinet").checked).toBe(false);
    expect(screen.getByText("Custom roles")).toBeInTheDocument();
    expect(checkbox("Historian").checked).toBe(true);
    expect(checkbox("Social Chair").checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Jane Smith's roles" }),
    ).toBeInTheDocument();
  });

  it("omits the custom-roles checklist when the list cannot load (no config access)", () => {
    customRolesState.data = undefined;
    customRolesState.isSuccess = false;
    customRolesState.isError = true;
    renderProfile();
    openRoleEditor();
    expect(screen.queryByText("Custom roles")).not.toBeInTheDocument();
  });
});

describe("MemberDetailSheet save payload", () => {
  it("sends the selection as-is, including ids of since-deleted roles", async () => {
    customRolesState.data = [
      { id: "cr1", key: "historian", label: "Historian", rank: 5, capabilities: [], core: false },
    ];
    // cr-deleted no longer exists in the chapter catalog. It is still sent
    // (the server exempts held ids): filtering against the possibly-stale
    // catalog would silently strip freshly assigned roles instead.
    renderProfile({ ...baseMember, custom_role_ids: ["cr-deleted"] });
    openRoleEditor();

    fireEvent.click(
      screen.getByText("Historian", { selector: "p" }).closest("label")!.querySelector("input")!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() => expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateRolesMutateAsync).toHaveBeenCalledWith({
      id: "m1",
      role_ids: [],
      custom_role_ids: ["cr-deleted", "cr1"],
    });
  });

  it("omits custom_role_ids entirely when the list could not load", async () => {
    customRolesState.data = undefined;
    customRolesState.isSuccess = false;
    customRolesState.isError = true;
    renderProfile({ ...baseMember, custom_role_ids: ["cr1"] });
    openRoleEditor();

    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() => expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1));
    // Omission tells the server "leave the assignment unchanged": the sheet
    // must never strip custom roles it could not display.
    expect(updateRolesMutateAsync).toHaveBeenCalledWith({
      id: "m1",
      role_ids: [],
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
      { id: "r-cabinet", name: "Cabinet", permissions: ["channels:read:cabinet"] },
    ];
  });

  afterEach(() => {
    mockRoles.current = [];
  });

  function renderHolding(roleIds: string[], customRoleIds: string[] = []) {
    renderProfile({ ...baseMember, role_ids: roleIds, custom_role_ids: customRoleIds });
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
      expect(screen.queryByText("Take away Jane Smith's access?")).not.toBeInTheDocument(),
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

    await waitFor(() => expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateRolesMutateAsync).toHaveBeenCalledWith({
      id: "m1",
      role_ids: ["r-cabinet"],
      custom_role_ids: [],
    });
  });

  it("counts a custom role carrying members:view as access", async () => {
    customRolesState.data = [
      { id: "cr-rush", key: "rush", label: "Rush", rank: 5, capabilities: ["members:view"], core: false },
    ];
    renderHolding(["r-cabinet"], ["cr-rush"]);
    untick("Rush");
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    expect(
      await screen.findByText("Take away Jane Smith's access?"),
    ).toBeInTheDocument();
    expect(updateRolesMutateAsync).not.toHaveBeenCalled();
  });

  it("saves without asking when the member keeps access", async () => {
    renderHolding(["r-member", "r-cabinet"]);
    untick("Cabinet");
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() => expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Take away Jane Smith's access?")).not.toBeInTheDocument();
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

// Every member can open this sheet, from the directory and from chat, so its
// writes mirror the permissions the server checks on them.
describe("MemberDetailSheet Remove member", () => {
  it("is absent for a viewer without members:remove", () => {
    mockPermissions.current = ["members:view", "roles:manage"];
    renderProfile();
    expect(
      screen.queryByRole("button", { name: /Remove member/ }),
    ).not.toBeInTheDocument();
  });

  it("removes after confirming, for a viewer holding members:remove", async () => {
    mockPermissions.current = ["members:view", "members:remove"];
    removeMutateAsync.mockResolvedValue({});
    const onOpenChange = vi.fn();
    renderProfile(baseMember, { onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: /Remove member/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove from chapter" }),
    );

    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalledWith("m1"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
