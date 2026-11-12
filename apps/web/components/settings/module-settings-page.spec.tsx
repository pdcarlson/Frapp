import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { roles, tiers, updateRole, updateTier, mine } = vi.hoisted(() => ({
  roles: {
    current: [] as Array<Record<string, unknown>>,
  },
  tiers: {
    current: [] as Array<Record<string, unknown>>,
  },
  updateRole: vi.fn(),
  updateTier: vi.fn(),
  mine: { permissions: ["*"] as string[] },
}));

const ok = (data: unknown) => ({
  data,
  isPending: false,
  isError: false,
  isSuccess: true,
});

vi.mock("@repo/hooks", () => ({
  useRoles: () => ok(roles.current),
  useRoleTiers: () => ok(tiers.current),
  useMembers: () => ok([{ user_id: "me", role_ids: ["p"] }]),
  useMyPermissions: () => ok({ permissions: mine.permissions }),
  useViewerUserId: () => "me",
  useUpdateRole: () => ({ mutateAsync: updateRole, isPending: false }),
  useUpdateRoleTier: () => ({ mutateAsync: updateTier, isPending: false }),
}));

vi.mock("@/lib/hooks/use-chapter-vocabulary", () => ({
  useChapterVocabulary: () => undefined,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { ModuleSettingsPage } = await import("./module-settings-page");
const { PointsRules, ServiceHoursRules } = await import("./module-rules");
const { moduleSettingsFor } = await import("./settings-modules");

const hours = moduleSettingsFor("hours")!;

/**
 * A module page (#4073) shows what is stored and read, for an officer setting
 * the module up for a 100-member chapter: the switch, the rules that save,
 * and who can do what, from the same roles the Roles page edits.
 */
describe("a module page", () => {
  it("says what switching it off took away, and that nothing was deleted", () => {
    render(
      <ModuleSettingsPage
        module={hours}
        on={false}
        canManage
        onToggle={vi.fn()}
        tools={[]}
        canSeeWhoCan={false}
      />,
    );
    expect(
      screen.getByRole("switch", { name: /service hours on/i }),
    ).not.toBeChecked();
    expect(screen.getByText(/service hours is off/i)).toHaveTextContent(
      /nothing was deleted/i,
    );
  });

  it("draws an always-on module locked, with no switch", () => {
    render(
      <ModuleSettingsPage
        module={moduleSettingsFor("chat")!}
        on
        canManage
        onToggle={vi.fn()}
        tools={[]}
        canSeeWhoCan={false}
      />,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Always on")).toBeInTheDocument();
  });

  it("lists each permission with the tiers and roles that have it, leaving the President's wildcard out", () => {
    tiers.current = [
      {
        id: "t1",
        name: "Exec board",
        position: 1,
        permissions: ["service:approve"],
      },
      { id: "t3", name: "Members", position: 3, permissions: ["service:log"] },
    ];
    roles.current = [
      { id: "p", name: "President", permissions: ["*"], display_order: 0 },
      {
        id: "s",
        name: "Service Chair",
        color: "#3366ff",
        permissions: ["service:approve", "service:log"],
        display_order: 3,
        tier_id: "t3",
      },
      {
        id: "m",
        name: "Member",
        permissions: ["service:log"],
        display_order: 9,
        tier_id: "t3",
      },
    ];
    render(
      <ModuleSettingsPage
        module={hours}
        on
        canManage
        onToggle={vi.fn()}
        tools={[]}
        canSeeWhoCan
      />,
    );
    const list = screen.getByRole("region", { name: /who can/i });
    const approve = within(list)
      .getByText(/approve service/i)
      .closest("li")!;
    // The tier answers for its roles; a role shows on its own only where
    // it differs from its tier.
    expect(approve).toHaveTextContent("Exec board");
    expect(approve).toHaveTextContent("Service Chair");
    expect(approve).not.toHaveTextContent("President");
    const log = within(list)
      .getByText(/^log service/i)
      .closest("li")!;
    expect(log).toHaveTextContent("Members");
    expect(log).not.toHaveTextContent("Member,");
    expect(log).not.toHaveTextContent("Service Chair");
    expect(
      within(list).getByRole("link", { name: /change in roles/i }),
    ).toHaveAttribute("href", "/settings?tab=roles");
    // Read-only without roles:manage: no remove or add controls.
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("lets a roles:manage holder take a permission from a tier right there", async () => {
    const user = userEvent.setup();
    updateTier.mockReset().mockResolvedValue(undefined);
    tiers.current = [
      { id: "t1", name: "Exec board", position: 1, permissions: [] },
      {
        id: "t2",
        name: "Officers",
        position: 2,
        permissions: ["service:approve", "service:log"],
      },
    ];
    roles.current = [
      { id: "p", name: "President", permissions: ["*"], display_order: 0 },
      {
        id: "s",
        name: "Service Chair",
        permissions: ["service:approve", "service:log"],
        display_order: 3,
        tier_id: "t2",
      },
    ];
    render(
      <ModuleSettingsPage
        module={hours}
        on
        canManage
        onToggle={vi.fn()}
        tools={[]}
        canSeeWhoCan
        canEditRoles
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: /remove officers from approve service/i,
      }),
    );
    expect(updateTier).toHaveBeenCalledWith({
      id: "t2",
      body: { permissions: ["service:log"] },
    });
  });

  it("adds a role to a permission from a list it can filter, leaving the President out", async () => {
    const user = userEvent.setup();
    updateRole.mockReset().mockResolvedValue(undefined);
    tiers.current = [];
    roles.current = [
      { id: "p", name: "President", permissions: ["*"], display_order: 0 },
      {
        id: "t",
        name: "Treasurer",
        permissions: ["service:log"],
        display_order: 2,
      },
      { id: "m", name: "Member", permissions: [], display_order: 9 },
    ];
    render(
      <ModuleSettingsPage
        module={hours}
        on
        canManage
        onToggle={vi.fn()}
        tools={[]}
        canSeeWhoCan
        canEditRoles
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /add to approve service/i }),
    );
    expect(screen.queryByRole("option", { name: /president/i })).toBeNull();
    await user.type(screen.getByPlaceholderText("Find a tier or role"), "trea");
    expect(screen.queryByRole("option", { name: "Member" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Treasurer" }));
    expect(updateRole).toHaveBeenCalledWith({
      id: "t",
      body: { permissions: ["service:log", "service:approve"] },
    });
  });

  it("offers no tier ranked at or above the caller's own", async () => {
    const user = userEvent.setup();
    mine.permissions = ["roles:manage", "service:approve", "members:view"];
    tiers.current = [
      { id: "t1", name: "Exec board", position: 1, permissions: [] },
      { id: "t2", name: "Officers", position: 2, permissions: [] },
    ];
    roles.current = [
      {
        id: "p",
        name: "Vice President",
        permissions: ["roles:manage", "service:approve"],
        display_order: 1,
        tier_id: "t1",
      },
    ];
    render(
      <ModuleSettingsPage
        module={hours}
        on
        canManage
        onToggle={vi.fn()}
        tools={[]}
        canSeeWhoCan
        canEditRoles
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /add to approve service/i }),
    );
    expect(
      screen.getByRole("option", { name: "Officers" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Exec board" })).toBeNull();
    mine.permissions = ["*"];
  });
});

describe("Service hours rules", () => {
  it("saves a new point rate as the service config, and says what it means", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceHoursRules
        minutesPerPoint={60}
        workflows={[{ key: "wf_hours_receipt", label: "x", enabled: true }]}
        canManage
        savingRate={false}
        savingWorkflows={false}
        onPatch={onPatch}
      />,
    );
    const rate = screen.getByLabelText(/minutes of service per point/i);
    await user.clear(rate);
    await user.type(rate, "30");
    expect(
      screen.getByText(/3-hour volunteer shift earns 6 points/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save rate/i }));
    expect(onPatch).toHaveBeenCalledWith(
      { service: { minutes_per_point: 30 } },
      "Point rate saved",
    );
  });

  it("refuses an empty rate under the field instead of sending it", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <ServiceHoursRules
        minutesPerPoint={60}
        workflows={[]}
        canManage
        savingRate={false}
        savingWorkflows={false}
        onPatch={onPatch}
      />,
    );
    await user.clear(screen.getByLabelText(/minutes of service per point/i));
    await user.click(screen.getByRole("button", { name: /save rate/i }));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a number.")).toBeInTheDocument();
  });

  it("saves the proof switch as the receipt workflow the API reads", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceHoursRules
        minutesPerPoint={60}
        workflows={[{ key: "wf_hours_receipt", label: "x", enabled: true }]}
        canManage
        savingRate={false}
        savingWorkflows={false}
        onPatch={onPatch}
      />,
    );
    await user.click(screen.getByRole("switch", { name: /ask for proof/i }));
    expect(onPatch).toHaveBeenCalledWith(
      { workflows: [{ key: "wf_hours_receipt", enabled: false }] },
      "Proof is now optional",
    );
  });
});

describe("Points rules", () => {
  it("refuses a rate limit over the API's ceiling by name", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    render(
      <PointsRules
        points={{ adjustment_rate_limit_per_hour: 50, anomaly_threshold: 100 }}
        canManage
        saving={false}
        onPatch={onPatch}
      />,
    );
    const rate = screen.getByLabelText(/adjustments per officer each hour/i);
    await user.clear(rate);
    await user.type(rate, "5000");
    await user.click(screen.getByRole("button", { name: /save limits/i }));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText("Use 1,000 or less.")).toBeInTheDocument();
  });

  it("is read-only for a role that can't manage chapter config", () => {
    render(
      <PointsRules
        points={undefined}
        canManage={false}
        saving={false}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/flag adjustments of/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save limits/i })).toBeNull();
  });
});
