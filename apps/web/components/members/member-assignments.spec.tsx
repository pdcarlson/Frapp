import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateRoles, setMembership, permissions, mockToast } = vi.hoisted(
  () => ({
    updateRoles: vi.fn(),
    setMembership: vi.fn(),
    permissions: { current: ["*"] as string[] },
    mockToast: vi.fn(),
  }),
);

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
  role("r-everyone", "Everyone", "t-chairs", {
    system_key: "MEMBER",
    is_system: true,
  }),
];

vi.mock("@/components/roles/use-roles-data", () => ({
  useRolesData: () => ({
    roles: ROLES,
    rolesQuery: { data: ROLES, isError: false },
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

  it("asks before taking away the last role that lets them open the app", async () => {
    const user = userEvent.setup();
    renderIt(["r-sec"]);
    await user.click(
      screen.getByRole("button", { name: "Remove Corresponding Secretary" }),
    );
    expect(
      await screen.findByText("Take away Jimmy Mitchell's access?"),
    ).toBeInTheDocument();
    expect(updateRoles).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Remove Corresponding Secretary" }),
    );
    await waitFor(() =>
      expect(updateRoles).toHaveBeenCalledWith({ id: "m1", role_ids: [] }),
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
    expect(headings).toEqual(["Groups", "Exec board"]);
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

  it("builds a second quick tick on the first, before the profile re-reads", async () => {
    const user = userEvent.setup();
    renderIt(["r-sec", "r-everyone"]);
    await user.click(
      screen.getByRole("button", { name: "Remove Corresponding Secretary" }),
    );
    // The access confirm: this was their last role with access.
    await user.click(
      await screen.findByRole("button", {
        name: "Remove Corresponding Secretary",
      }),
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
