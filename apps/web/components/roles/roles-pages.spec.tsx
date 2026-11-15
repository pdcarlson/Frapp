import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkMock } from "@/tests/network";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

/**
 * The Roles pages (#3990), walked as an officer of a chapter with tiers: the
 * list of tiers and their roles, a tier's page of switches, and a role's own
 * page. The rank rules (#4071) are mirrored only to disable controls the API
 * would refuse, so the tests pin which controls are live for whom.
 */

const h = vi.hoisted(() => ({
  offline: { value: false },
  roles: [] as Array<Record<string, unknown>>,
  tiers: [] as Array<Record<string, unknown>>,
  members: [] as Array<Record<string, unknown>>,
  mine: ["*"] as string[],
  // `null` is a server without AI; an object is one that has it.
  aiConsent: null as object | null,
  vocabulary: undefined as { vocabulary: Record<string, string> } | undefined,
  updateRole: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  updateTier: vi.fn(),
  createTier: vi.fn(),
  deleteTier: vi.fn(),
  reorderTiers: vi.fn(),
  push: vi.fn(),
}));

const ok = (data: unknown) => ({
  data,
  error: null,
  isPending: false,
  isError: false,
  isSuccess: true,
  refetch: vi.fn(),
});
const mutation = (fn: ReturnType<typeof vi.fn>) => ({
  mutateAsync: fn,
  isPending: false,
});

vi.mock("@/lib/providers/network-provider", () => networkMock(h.offline));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams("tab=roles&role=brother"),
}));
vi.mock("@repo/hooks", async (importOriginal) => {
  // The real rule (#4504), fed whether this server has AI from `h`.
  const { isPermissionHidden } =
    await importOriginal<typeof import("@repo/hooks")>();
  return {
    useAiConsent: () => ({ data: h.aiConsent }),
    aiAvailableFrom: (consent: { data: object | null | undefined }) =>
      consent.data === undefined ? undefined : consent.data !== null,
    useIsPermissionHidden: () => (permission: string) =>
      isPermissionHidden(
        permission,
        h.aiConsent === undefined ? undefined : h.aiConsent !== null,
      ),
    useRoles: () => ok(h.roles),
    useRoleTiers: () => ok(h.tiers),
    useMembers: () => ok(h.members),
    useMyPermissions: () => ok({ permissions: h.mine }),
    useViewerUserId: () => "me",
    useUpdateRole: () => mutation(h.updateRole),
    useCreateRole: () => mutation(h.createRole),
    useDeleteRole: () => mutation(h.deleteRole),
    useUpdateRoleTier: () => mutation(h.updateTier),
    useCreateRoleTier: () => mutation(h.createTier),
    useDeleteRoleTier: () => mutation(h.deleteTier),
    useReorderRoleTiers: () => mutation(h.reorderTiers),
  };
});
vi.mock("@/lib/hooks/use-chapter-vocabulary", () => ({
  useChapterVocabulary: () => h.vocabulary,
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { RolesOverview } from "@/components/roles/roles-overview";
import { TierPermissionsPage } from "@/components/roles/tier-permissions-page";
import { RolePage } from "@/components/roles/role-page";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useRolePreviewStore } from "@/lib/stores/role-preview-store";

const EXEC = {
  id: "t1",
  name: "Exec board",
  position: 1,
  permissions: ["members:view", "roles:manage", "service:approve"],
};
const OFFICERS = {
  id: "t2",
  name: "Officers and chairs",
  position: 2,
  permissions: ["members:view", "service:approve"],
};
const MEMBERS = {
  id: "t3",
  name: "Members",
  position: 3,
  permissions: ["members:view"],
};

const role = (
  id: string,
  name: string,
  tier: string | null,
  permissions: string[],
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  tier_id: tier,
  permissions,
  permission_overrides: {},
  is_system: false,
  display_order: 1,
  color: null,
  ...extra,
});

function chapter() {
  h.tiers = [EXEC, OFFICERS, MEMBERS];
  h.roles = [
    role("pres", "President", "t1", ["*"], { is_system: true }),
    role("vp", "Vice President", "t1", EXEC.permissions),
    role(
      "treas",
      "Treasurer",
      "t2",
      [...OFFICERS.permissions, "events:create"],
      {
        permission_overrides: { "events:create": true },
      },
    ),
    role("brother", "Brothers", "t3", MEMBERS.permissions),
    role("alum", "Alumni", null, []),
    role("member", "Member", "t3", ["members:view", "chat:send"], {
      is_system: true,
      system_key: "MEMBER",
    }),
    role("cabinet", "Cabinet", null, ["channels:read:cabinet"]),
  ];
  h.members = [
    { user_id: "me", role_ids: ["pres"] },
    { user_id: "u2", role_ids: ["brother"] },
    { user_id: "u3", role_ids: ["brother", "treas"] },
  ];
  h.mine = ["*"];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.offline.value = false;
  h.vocabulary = undefined;
  for (const fn of [
    h.updateRole,
    h.createRole,
    h.deleteRole,
    h.updateTier,
    h.createTier,
    h.deleteTier,
    h.reorderTiers,
  ]) {
    fn.mockResolvedValue({});
  }
  chapter();
  useChapterStore.setState({ activeChapterId: "c1" });
  useRolePreviewStore.setState({ preview: null });
});

/** Make the caller the Vice President: Exec board, not the President. */
function asVicePresident() {
  h.members = [{ user_id: "me", role_ids: ["vp"] }];
  h.mine = EXEC.permissions;
}

describe("the tier list", () => {
  it("shows the tiers in order with their roles, then the roles outside them", () => {
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Exec board",
      "Officers and chairs",
      "Members",
      "Outside the tiers",
      "Non-chapter business",
    ]);
    const members = screen.getByRole("region", { name: "Members" });
    expect(members).toHaveTextContent("Brothers");
    expect(members).toHaveTextContent("2 members");
    expect(
      screen.getByRole("region", { name: "Outside the tiers" }),
    ).toHaveTextContent("Alumni");
    expect(screen.getByText("Can do everything")).toBeInTheDocument();
  });

  it("lists the roles members pick themselves under Non-chapter business (#4958)", () => {
    h.roles = [
      ...h.roles,
      role("im", "Intramurals", null, [], { self_assignable: true }),
    ];
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    expect(
      screen.getByRole("region", { name: "Non-chapter business" }),
    ).toHaveTextContent("Intramurals");
    expect(
      screen.getByRole("region", { name: "Outside the tiers" }),
    ).not.toHaveTextContent("Intramurals");
  });

  it("offers no move into a tier on a Non-chapter business role", async () => {
    h.roles = [
      ...h.roles,
      role("im", "Intramurals", null, [], { self_assignable: true }),
    ];
    const user = userEvent.setup();
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: "More for Intramurals" }),
    );
    expect(screen.queryByRole("menuitem", { name: "Exec board" })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Delete role" }),
    ).toBeInTheDocument();
  });

  it("hides an empty Non-chapter business from a member who can't manage roles", () => {
    h.members = [{ user_id: "me", role_ids: ["brother"] }];
    h.mine = MEMBERS.permissions;
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    expect(
      screen.queryByRole("region", { name: "Non-chapter business" }),
    ).toBeNull();
  });

  it("uses the chapter's own word for a tier", () => {
    h.vocabulary = { vocabulary: { tier: "Level" } };
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    expect(screen.getByText("7 roles in 3 levels")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Outside the levels" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add level" }),
    ).toBeInTheDocument();
  });

  it("opens a tier's permissions and a role's page", async () => {
    const user = userEvent.setup();
    const onOpenTier = vi.fn();
    const onOpenRole = vi.fn();
    render(<RolesOverview onOpenTier={onOpenTier} onOpenRole={onOpenRole} />);
    const officers = screen.getByRole("region", {
      name: "Officers and chairs",
    });
    await user.click(
      within(officers).getByRole("button", { name: "Edit permissions" }),
    );
    expect(onOpenTier).toHaveBeenCalledWith("t2");
    await user.click(
      within(officers).getByRole("button", { name: /^treasurer/i }),
    );
    expect(onOpenRole).toHaveBeenCalledWith("treas");
  });

  it("adds a role into a tier, taking the tier's permissions", async () => {
    const user = userEvent.setup();
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    const officers = screen.getByRole("region", {
      name: "Officers and chairs",
    });
    await user.click(
      within(officers).getByRole("button", { name: "Add role" }),
    );
    await user.type(
      within(officers).getByRole("textbox", { name: "New role name" }),
      "Social chair{Enter}",
    );
    expect(h.createRole).toHaveBeenCalledWith({
      name: "Social chair",
      permissions: [],
      tier_id: "t2",
    });
  });

  it("moves a tier down with the whole order, highest first", async () => {
    const user = userEvent.setup();
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: "More for Officers and chairs" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(h.reorderTiers).toHaveBeenCalledWith(["t1", "t3", "t2"]);
  });

  it("deletes only an empty tier, after a confirmation", async () => {
    const user = userEvent.setup();
    h.tiers = [
      ...h.tiers,
      { id: "t4", name: "Pledges", position: 4, permissions: [] },
    ];
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "More for Members" }));
    expect(
      screen.getByRole("menuitem", {
        name: /delete \(move its roles out first\)/i,
      }),
    ).toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "More for Pledges" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(h.deleteTier).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete tier",
      }),
    );
    await waitFor(() => expect(h.deleteTier).toHaveBeenCalledWith("t4"));
  });

  it("moves a role to another tier from its menu", async () => {
    const user = userEvent.setup();
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "More for Brothers" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Officers and chairs" }),
    );
    expect(h.updateRole).toHaveBeenCalledWith({
      id: "brother",
      body: { tier_id: "t2" },
    });
  });

  it("keeps the caller's own tier and everything above it out of reach", async () => {
    const user = userEvent.setup();
    asVicePresident();
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    const exec = screen.getByRole("region", { name: "Exec board" });
    expect(
      within(exec).getByRole("button", { name: "View permissions" }),
    ).toBeInTheDocument();
    expect(within(exec).queryByRole("button", { name: "Add role" })).toBeNull();
    const officers = screen.getByRole("region", {
      name: "Officers and chairs",
    });
    expect(
      within(officers).getByRole("button", { name: "Edit permissions" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More for Brothers" }));
    expect(
      screen.getByRole("menuitem", { name: "Exec board" }),
    ).toHaveAttribute("data-disabled");
  });

  it("finds a role by name across a chapter with many", async () => {
    const user = userEvent.setup();
    h.roles = [
      ...h.roles,
      ...Array.from({ length: 100 }, (_, i) =>
        role(`r${i}`, `Committee ${i}`, "t3", MEMBERS.permissions),
      ),
    ];
    render(<RolesOverview onOpenTier={vi.fn()} onOpenRole={vi.fn()} />);
    await user.type(screen.getByPlaceholderText("Find a role"), "treas");
    expect(
      screen.getByRole("button", { name: /^treasurer/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Committee 4")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
  });
});

describe("a tier's permissions", () => {
  it("lists every module's switches and saves a flip as the tier's whole list", async () => {
    const user = userEvent.setup();
    render(
      <TierPermissionsPage tierId="t2" onBack={vi.fn()} onOpenRole={vi.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: "Officers and chairs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    const approve = screen.getByRole("switch", {
      name: /approve service hours for officers and chairs/i,
    });
    expect(approve).toBeChecked();
    await user.click(approve);
    expect(h.updateTier).toHaveBeenCalledWith({
      id: "t2",
      body: { permissions: ["members:view"] },
    });
  });

  it("composes a second flip on the first, not on stale props", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    h.updateTier.mockImplementationOnce(
      () => new Promise<void>((done) => (resolve = done)),
    );
    render(
      <TierPermissionsPage tierId="t3" onBack={vi.fn()} onOpenRole={vi.fn()} />,
    );
    await user.click(
      screen.getByRole("switch", { name: /^create events for/i }),
    );
    resolve();
    await waitFor(() => expect(h.updateTier).toHaveBeenCalledTimes(1));
    await user.click(
      screen.getByRole("switch", { name: /^create polls for/i }),
    );
    expect(h.updateTier).toHaveBeenLastCalledWith({
      id: "t3",
      body: { permissions: ["members:view", "events:create", "polls:create"] },
    });
  });

  it("is read-only for a tier at or above the caller's own, and says why", () => {
    asVicePresident();
    render(
      <TierPermissionsPage tierId="t1" onBack={vi.fn()} onOpenRole={vi.fn()} />,
    );
    expect(screen.getByText(/ranks at or above yours/i)).toBeInTheDocument();
    for (const control of screen.getAllByRole("switch")) {
      expect(control).toBeDisabled();
    }
  });

  it("won't switch on what the caller doesn't hold, and says so on the row", () => {
    asVicePresident();
    render(
      <TierPermissionsPage tierId="t2" onBack={vi.fn()} onOpenRole={vi.fn()} />,
    );
    expect(
      screen.getByRole("switch", { name: /^create events for/i }),
    ).toBeDisabled();
    // On already, so taking it away is still allowed.
    expect(
      screen.getByRole("switch", { name: /approve service hours for/i }),
    ).toBeEnabled();
  });

  it("never draws the wildcard as a switch", () => {
    render(
      <TierPermissionsPage tierId="t1" onBack={vi.fn()} onOpenRole={vi.fn()} />,
    );
    expect(screen.queryByRole("switch", { name: /everything/i })).toBeNull();
  });

  it("leaves out the AI switches while the server has AI off", () => {
    h.aiConsent = null;
    render(
      <TierPermissionsPage tierId="t1" onBack={vi.fn()} onOpenRole={vi.fn()} />,
    );
    expect(screen.queryByRole("switch", { name: /use ai/i })).toBeNull();
    expect(
      screen.queryByRole("switch", { name: /let ai take actions/i }),
    ).toBeNull();
  });

  it("offers the AI switches once the server has AI", () => {
    h.aiConsent = {};
    try {
      render(
        <TierPermissionsPage
          tierId="t1"
          onBack={vi.fn()}
          onOpenRole={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("switch", { name: /use ai/i }),
      ).toBeInTheDocument();
    } finally {
      h.aiConsent = null;
    }
  });
});

describe("a role's page", () => {
  it("marks where the role differs from its tier", () => {
    render(<RolePage roleId="treas" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(
      screen.getByText(
        /on for this role only\. officers and chairs has it off/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/starts from officers and chairs/i),
    ).toBeInTheDocument();
  });

  it("shows the tier's answer beside the role's own, Same as tier where it has none", () => {
    render(<RolePage roleId="treas" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    const service = screen.getByRole("radiogroup", {
      name: /approve service hours for treasurer/i,
    });
    expect(
      within(service).getByRole("radio", { name: "Same as tier" }),
    ).toHaveAttribute("aria-checked", "true");
    const events = screen.getByRole("radiogroup", {
      name: /create events for treasurer/i,
    });
    expect(within(events).getByRole("radio", { name: "On" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("saves a pick as one override key, and Same as tier clears it", async () => {
    const user = userEvent.setup();
    render(<RolePage roleId="treas" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    await user.click(
      within(
        screen.getByRole("radiogroup", {
          name: /approve service hours for treasurer/i,
        }),
      ).getByRole("radio", { name: "Off" }),
    );
    expect(h.updateRole).toHaveBeenCalledWith({
      id: "treas",
      body: { permission_overrides: { "service:approve": false } },
    });
    await user.click(
      within(
        screen.getByRole("radiogroup", {
          name: /create events for treasurer/i,
        }),
      ).getByRole("radio", { name: "Same as tier" }),
    );
    expect(h.updateRole).toHaveBeenLastCalledWith({
      id: "treas",
      body: { permission_overrides: { "events:create": null } },
    });
  });

  it("puts the chapter's word for a tier on the Same as answer", () => {
    h.vocabulary = { vocabulary: { tier: "Level" } };
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(
      screen.getAllByRole("radio", { name: "Same as level" }).length,
    ).toBeGreaterThan(0);
  });

  it("won't switch on what the caller doesn't hold, and says so on the row", () => {
    asVicePresident();
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    const events = screen.getByRole("radiogroup", {
      name: /create events for brothers/i,
    });
    expect(within(events).getByRole("radio", { name: "On" })).toBeDisabled();
    expect(within(events).getByRole("radio", { name: "Off" })).toBeEnabled();
    expect(
      screen.getAllByText(/your role doesn't have it/i).length,
    ).toBeGreaterThan(0);
  });

  it("gives a role outside the tiers one column of live switches", async () => {
    const user = userEvent.setup();
    render(<RolePage roleId="alum" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    await user.click(
      screen.getByRole("switch", { name: /create events for alumni/i }),
    );
    expect(h.updateRole).toHaveBeenCalledWith({
      id: "alum",
      body: { permissions: ["events:create"] },
    });
  });

  it("views the app as the role, then comes back to its page", async () => {
    const user = userEvent.setup();
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "View as Brothers" }));
    expect(useRolePreviewStore.getState().preview).toEqual({
      chapterId: "c1",
      roleId: "brother",
      roleName: "Brothers",
      permissions: ["members:view"],
      returnTo: "/settings?tab=roles&role=brother",
    });
    expect(h.push).toHaveBeenCalledWith("/chat");
  });

  it("previews a role that opens nothing on its own with Member beside it, as a join would", async () => {
    const user = userEvent.setup();
    render(<RolePage roleId="cabinet" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "View as Cabinet" }));
    expect(useRolePreviewStore.getState().preview?.permissions).toEqual([
      "channels:read:cabinet",
      "members:view",
      "chat:send",
    ]);
  });

  it("offers no View as on the President's role, or to someone who can't edit roles", () => {
    render(<RolePage roleId="pres" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^view as/i })).toBeNull();
  });

  it("locks every switch on the President's role", () => {
    render(<RolePage roleId="pres" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(
      screen.getByText(/only moves through transfer presidency/i),
    ).toBeInTheDocument();
    for (const control of screen.getAllByRole("switch")) {
      expect(control).toBeDisabled();
    }
  });

  it("saves details without a permissions key, and moves the role between tiers", async () => {
    const user = userEvent.setup();
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Tier" }));
    await user.click(
      screen.getByRole("option", { name: "Officers and chairs" }),
    );
    await user.click(
      screen.getByRole("switch", { name: /anyone can @mention/i }),
    );
    await user.click(screen.getByRole("button", { name: "Save role" }));
    expect(h.updateRole).toHaveBeenCalledWith({
      id: "brother",
      body: {
        name: undefined,
        color: undefined,
        display_order: 1,
        mentionable: false,
        tier_id: "t2",
      },
    });
  });

  it("marks a role outside the tiers as Non-chapter business (#4958)", async () => {
    const user = userEvent.setup();
    render(<RolePage roleId="alum" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    await user.click(
      screen.getByRole("switch", { name: "Non-chapter business" }),
    );
    await user.click(screen.getByRole("button", { name: "Save role" }));
    expect(h.updateRole.mock.calls[0]![0].body).toMatchObject({
      self_assignable: true,
    });
  });

  it("explains why a role in a tier can't be Non-chapter business", () => {
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(
      screen.getByRole("switch", { name: "Non-chapter business" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Roles members pick themselves sit outside the tiers/),
    ).toBeInTheDocument();
  });

  it("lets a tiered role moved out of its tier be marked in the same save", async () => {
    // The switch judges the permissions the save leaves: Brothers carries
    // only its tier's, so outside the tiers it holds none.
    const user = userEvent.setup();
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Tier" }));
    await user.click(screen.getByRole("option", { name: "Outside the tiers" }));
    const pick = screen.getByRole("switch", { name: "Non-chapter business" });
    expect(pick).toBeEnabled();
    await user.click(pick);
    await user.click(screen.getByRole("button", { name: "Save role" }));
    expect(h.updateRole.mock.calls[0]![0].body).toMatchObject({
      tier_id: null,
      self_assignable: true,
    });
  });

  it("refuses to mark a role outside the tiers that carries a permission", () => {
    h.roles = [
      ...h.roles,
      role("rush", "Rush crew", null, ["events:create"], {
        permission_overrides: { "events:create": true },
      }),
    ];
    render(<RolePage roleId="rush" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(
      screen.getByRole("switch", { name: "Non-chapter business" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/can't carry permissions, since anyone can join them/),
    ).toBeInTheDocument();
  });

  it("judges a drafted move into a tier, and still lets a marked role be turned off", async () => {
    h.roles = [
      ...h.roles,
      role("im", "Intramurals", null, [], { self_assignable: true }),
    ];
    const user = userEvent.setup();
    render(<RolePage roleId="im" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Tier" }));
    await user.click(screen.getByRole("option", { name: "Members" }));
    expect(
      screen.getByText(/Roles members pick themselves sit outside the tiers/),
    ).toBeInTheDocument();
    const pick = screen.getByRole("switch", { name: "Non-chapter business" });
    expect(pick).toBeEnabled();
    await user.click(pick);
    expect(pick).not.toBeChecked();
    expect(pick).toBeDisabled();
  });

  it("offers no Non-chapter business switch on a built-in role", () => {
    render(<RolePage roleId="member" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(
      screen.queryByRole("switch", { name: "Non-chapter business" }),
    ).toBeNull();
  });

  it("saves a picked swatch, and leaves an untouched color out", async () => {
    const user = userEvent.setup();
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    const swatches = within(
      screen.getByRole("group", { name: "Color" }),
    ).getAllByRole("button");
    await user.click(swatches[1]!);
    await user.click(screen.getByRole("button", { name: "Save role" }));
    const body = h.updateRole.mock.calls[0]![0].body;
    expect(typeof body.color).toBe("string");
    expect(body).not.toHaveProperty("permissions", expect.anything());
  });

  it("keeps the last whole number in the position field (#2206)", () => {
    render(<RolePage roleId="brother" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    const field = screen.getByLabelText("Position in its list");
    expectRefusedEntriesKeep(field, "4");
    expectClearingEntriesEmpty(field, "4");
  });

  it("deletes a role only after a confirmation, then goes back", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<RolePage roleId="alum" onBack={onBack} onOpenTier={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Delete role" }));
    expect(h.deleteRole).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete role",
      }),
    );
    await waitFor(() => expect(h.deleteRole).toHaveBeenCalledWith("alum"));
    expect(onBack).toHaveBeenCalled();
  });

  it("is read-only for a role in the caller's own tier", () => {
    asVicePresident();
    render(<RolePage roleId="vp" onBack={vi.fn()} onOpenTier={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Save role" })).toBeNull();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });
});
