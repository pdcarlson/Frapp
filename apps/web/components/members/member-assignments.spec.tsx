import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateRoles, setMembership, permissions, mockToast, baseRoles } =
  vi.hoisted(() => ({
    updateRoles: vi.fn(),
    setMembership: vi.fn(),
    permissions: { current: ["*"] as string[] },
    mockToast: vi.fn(),
    // The chapter's base roles, off unless a test seeds them (#5802).
    baseRoles: { current: [] as ReturnType<typeof Object>[] },
  }));

const TIERS = [
  {
    id: "t-exec",
    name: "Exec board",
    position: 1,
    permissions: [],
    mentionable: true,
  },
  {
    id: "t-chairs",
    name: "Chairs",
    position: 2,
    permissions: [],
    mentionable: true,
  },
];

function role(id: string, name: string, tier_id: string | null, extra = {}) {
  return {
    id,
    name,
    color: null,
    permissions: [] as string[],
    is_system: false,
    system_key: null as string | null,
    display_order: 1,
    mentionable: true,
    tier_id,
    permission_overrides: {},
    self_assignable: false,
    ...extra,
  };
}

const ROLES = [
  role("r-pres", "President", "t-exec", { permissions: ["*"] }),
  role("r-sec", "Corresponding Secretary", "t-exec", {
    permissions: ["members:view"],
  }),
  role("r-social", "Social chair", "t-chairs"),
  role("r-rush", "Rush chair", "t-chairs"),
  role("r-everyone", "Everyone", null, {
    system_key: "EVERYONE",
    is_system: true,
  }),
];

vi.mock("@/components/roles/use-roles-data", () => ({
  useRolesData: () => ({
    roles: [...ROLES, ...baseRoles.current],
    rolesQuery: { data: [...ROLES, ...baseRoles.current], isError: false },
    tiers: TIERS,
    reach: {
      wildcard: permissions.current.includes("*"),
      known: true,
      rank: 1,
      held: new Set(permissions.current),
    },
    canManage:
      permissions.current.includes("*") ||
      permissions.current.includes("roles:manage"),
  }),
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ASSIGN_COPY: actual.ASSIGN_COPY,
    memberAssignmentSections: actual.memberAssignmentSections,
    memberGroupChips: actual.memberGroupChips,
    memberRoleChips: actual.memberRoleChips,
    needsBaseRole: actual.needsBaseRole,
    NO_BASE_ROLE_LABEL: actual.NO_BASE_ROLE_LABEL,
    useGroups: () => ({
      data: [
        {
          id: "g-house",
          name: "In house",
          kind: "manual",
          color: null,
          member_ids: ["u1"],
        },
        {
          id: "g-campus",
          name: "On campus",
          kind: "manual",
          color: null,
          member_ids: [],
        },
        {
          id: "g-class",
          name: "Fall 2025",
          kind: "pledge_class",
          color: null,
          member_ids: ["u1"],
        },
      ],
    }),
    useMyPermissions: () => ({ data: { permissions: permissions.current } }),
    useUpdateMemberRoles: () => ({ mutateAsync: updateRoles }),
    useSetGroupMembership: () => ({ mutateAsync: setMembership }),
  };
});

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { MemberAssignments } from "./member-assignments";

function renderIt(roleIds = ["r-sec", "r-everyone"]) {
  return render(
    <MemberAssignments
      memberId="m1"
      userId="u1"
      roleIds={roleIds}
      displayName="Jimmy Mitchell"
    />,
  );
}

beforeEach(() => {
  permissions.current = ["*"];
  baseRoles.current = [];
  updateRoles.mockReset().mockResolvedValue({});
  setMembership.mockReset().mockResolvedValue({});
  mockToast.mockReset();
});

describe("MemberAssignments (Paul, 2026-11-19)", () => {
  it("shows roles, then groups, with the Everyone role left out", () => {
    renderIt();
    const roles = screen.getByRole("region", { name: "Roles" });
    const groups = screen.getByRole("region", { name: "Groups" });
    expect(roles).toHaveTextContent("Corresponding Secretary");
    expect(roles).not.toHaveTextContent("Everyone");
    expect(groups).toHaveTextContent("In house");
    expect(groups).toHaveTextContent("Fall 2025");
  });

  it("takes a group away from its chip at once, but never a followed one", async () => {
    const user = userEvent.setup();
    renderIt();
    expect(
      screen.queryByRole("button", { name: "Remove Fall 2025" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove In house" }));
    expect(setMembership).toHaveBeenCalledWith({
      groupId: "g-house",
      userId: "u1",
      in: false,
    });
  });

  it("takes away a member's last role at once, leaving them Everyone", async () => {
    const user = userEvent.setup();
    renderIt(["r-sec", "r-everyone"]);
    await user.click(
      screen.getByRole("button", { name: "Remove Corresponding Secretary" }),
    );
    await waitFor(() =>
      expect(updateRoles).toHaveBeenCalledWith({
        id: "m1",
        role_ids: ["r-everyone"],
      }),
    );
  });

  it("gives a role or a group from one list, each saving as it is ticked", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: "Add to group" }));
    const list = screen.getByRole("dialog", {
      name: "Roles and groups for Jimmy Mitchell",
    });
    // Opened for groups, so groups come first; roles are in the same list.
    const headings = within(list)
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(headings).toEqual(["Groups", "Exec board", "Chairs"]);
    expect(within(list).queryByText("Fall 2025")).toBeNull();

    await user.click(
      within(list).getByRole("menuitemcheckbox", { name: /On campus/ }),
    );
    expect(setMembership).toHaveBeenCalledWith({
      groupId: "g-campus",
      userId: "u1",
      in: true,
    });

    // The President's role is listed but moves only by Transfer presidency.
    expect(
      within(list).getByRole("menuitemcheckbox", { name: /President/ }),
    ).toBeDisabled();
  });

  // #5752: a tick used to disable every row while it saved, which dropped
  // focus to the page; the profile panel took it back, and that closed the
  // list after each pick. Now the ticked row shows its new state at once and
  // keeps focus, and other ticks queue behind its save.
  it("shows a tick at once and keeps the list open for more while it saves", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    setMembership.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    renderIt();
    await user.click(screen.getByRole("button", { name: "Add to group" }));
    const list = screen.getByRole("dialog", {
      name: "Roles and groups for Jimmy Mitchell",
    });
    const campus = within(list).getByRole("menuitemcheckbox", {
      name: /On campus/,
    });
    await user.click(campus);

    // Saving: ticked already, focus kept, waiting without being disabled.
    expect(campus).toHaveAttribute("aria-checked", "true");
    expect(campus).toHaveFocus();
    expect(campus).not.toBeDisabled();
    expect(campus).toHaveAttribute("aria-disabled", "true");
    // A second press on the same row while it saves does nothing.
    await user.click(campus);
    expect(setMembership).toHaveBeenCalledTimes(1);

    // Another row takes its tick now and saves once the first is done.
    const house = within(list).getByRole("menuitemcheckbox", {
      name: /In house/,
    });
    await user.click(house);
    expect(house).toHaveAttribute("aria-checked", "false");
    expect(setMembership).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() =>
      expect(setMembership).toHaveBeenLastCalledWith({
        groupId: "g-house",
        userId: "u1",
        in: false,
      }),
    );
    await waitFor(() => expect(campus).not.toHaveAttribute("aria-disabled"));
    expect(
      screen.getByRole("dialog", {
        name: "Roles and groups for Jimmy Mitchell",
      }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Roles and groups for Jimmy Mitchell",
        }),
      ).toBeNull(),
    );
  });

  it("gives two roles in one opening, the second built on the first", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    updateRoles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    renderIt(["r-sec", "r-everyone"]);
    await user.click(screen.getByRole("button", { name: "Add role" }));
    const list = screen.getByRole("dialog", {
      name: "Roles and groups for Jimmy Mitchell",
    });
    await user.click(
      within(list).getByRole("menuitemcheckbox", { name: /Social chair/ }),
    );
    // The second tick comes before the first save answers.
    await user.click(
      within(list).getByRole("menuitemcheckbox", { name: /Rush chair/ }),
    );
    expect(updateRoles).toHaveBeenCalledTimes(1);
    expect(updateRoles).toHaveBeenLastCalledWith({
      id: "m1",
      role_ids: ["r-sec", "r-social", "r-everyone"],
    });

    finish();
    await waitFor(() => expect(updateRoles).toHaveBeenCalledTimes(2));
    expect(updateRoles).toHaveBeenLastCalledWith({
      id: "m1",
      role_ids: ["r-sec", "r-social", "r-rush", "r-everyone"],
    });
    expect(list).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(list).getByRole("menuitemcheckbox", { name: /Rush chair/ }),
      ).toHaveAttribute("aria-checked", "true"),
    );
    expect(
      within(list).getByRole("menuitemcheckbox", { name: /Social chair/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("closes the list on a click outside it", async () => {
    const user = userEvent.setup();
    renderIt();
    await user.click(screen.getByRole("button", { name: "Add role" }));
    expect(
      screen.getByRole("dialog", {
        name: "Roles and groups for Jimmy Mitchell",
      }),
    ).toBeInTheDocument();
    await user.click(document.body);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Roles and groups for Jimmy Mitchell",
        }),
      ).toBeNull(),
    );
  });

  it("builds a second quick tick on the first, before the profile re-reads", async () => {
    const user = userEvent.setup();
    renderIt(["r-sec", "r-everyone"]);
    await user.click(
      screen.getByRole("button", { name: "Remove Corresponding Secretary" }),
    );
    await waitFor(() => expect(updateRoles).toHaveBeenCalledTimes(1));
    // The profile prop still holds the old list; the chip is gone anyway.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Remove Corresponding Secretary",
        }),
      ).toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "Add role" }));
    const list = screen.getByRole("dialog", {
      name: "Roles and groups for Jimmy Mitchell",
    });
    expect(
      within(list).getByRole("menuitemcheckbox", {
        name: /Corresponding Secretary/,
      }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("offers a plain member no way to change anything", () => {
    permissions.current = ["members:view"];
    renderIt();
    expect(screen.queryByRole("button", { name: /^Add/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("says what went wrong when a save is refused", async () => {
    const user = userEvent.setup();
    setMembership.mockRejectedValue(
      new Error(
        "Only someone who can manage channels can change who is in it.",
      ),
    );
    renderIt();
    await user.click(screen.getByRole("button", { name: "Remove In house" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Couldn't take out of that group" }),
      ),
    );
  });
});

describe("base roles (#5802)", () => {
  beforeEach(() => {
    baseRoles.current = [
      role("r-new", "New Member", "t-chairs", {
        system_key: "NEW_MEMBER",
        is_system: true,
      }),
      role("r-actives", "Actives", "t-chairs", {
        system_key: "MEMBER",
        is_system: true,
      }),
      role("r-alumni", "Alumni", null, {
        system_key: "ALUMNI",
        is_system: true,
      }),
    ];
  });

  it("says a member holds no base role, only to someone who can give one", () => {
    const { unmount } = renderIt(["r-sec", "r-everyone"]);
    expect(screen.getByText("No base role")).toBeInTheDocument();
    unmount();
    permissions.current = ["members:view"];
    renderIt(["r-sec", "r-everyone"]);
    expect(screen.queryByText("No base role")).toBeNull();
  });

  it("offers the base roles as one pick, and a new one replaces the old", async () => {
    const user = userEvent.setup();
    renderIt(["r-sec", "r-actives", "r-everyone"]);
    expect(screen.queryByText("No base role")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add role" }));
    const list = screen.getByRole("dialog", {
      name: "Roles and groups for Jimmy Mitchell",
    });
    expect(
      within(list).getByRole("menuitemradio", { name: /Actives/ }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(
      within(list).getByRole("menuitemradio", { name: /Alumni/ }),
    );
    await waitFor(() =>
      expect(updateRoles).toHaveBeenCalledWith({
        id: "m1",
        role_ids: ["r-sec", "r-alumni", "r-everyone"],
      }),
    );
  });
});
