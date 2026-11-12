import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the data hooks so the tab renders without a query client / network.
const mockUseRoles = vi.fn();
const mockSaveDefaultRole = vi.fn();
const mockPermissions = vi.fn();
const mockParams = { value: new URLSearchParams("tab=roles") };
const mockPush = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRoles: () => mockUseRoles(),
  useMyPermissions: () => ({
    data: { permissions: mockPermissions() },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockParams.value,
  useRouter: () => ({ push: mockPush }),
}));

// The three pages have their own spec (`roles/roles-pages.spec.tsx`); here
// only which one the URL picks, and how each one navigates, are under test.
vi.mock("@/components/roles/roles-overview", () => ({
  RolesOverview: (props: {
    onOpenTier: (id: string) => void;
    onOpenRole: (id: string) => void;
  }) => (
    <div data-testid="overview">
      <button onClick={() => props.onOpenTier("tier-1")}>open tier</button>
      <button onClick={() => props.onOpenRole("role-1")}>open role</button>
    </div>
  ),
}));
vi.mock("@/components/roles/tier-permissions-page", () => ({
  TierPermissionsPage: (props: { tierId: string; onBack: () => void }) => (
    <div data-testid="tier-page">
      {props.tierId}
      <button onClick={props.onBack}>back</button>
    </div>
  ),
}));
vi.mock("@/components/roles/role-page", () => ({
  RolePage: (props: { roleId: string }) => (
    <div data-testid="role-page">{props.roleId}</div>
  ),
}));
vi.mock("@/components/roles/presidency", () => ({
  PresidencyClaimBanner: () => null,
  TransferPresidencySection: () => <div data-testid="transfer" />,
}));

import { SettingsRolesTab } from "./settings-roles-tab";

/** The hook mocks every test in this file renders against. */
function primeMocks() {
  vi.clearAllMocks();
  mockParams.value = new URLSearchParams("tab=roles");
  mockUseRoles.mockReturnValue({
    data: [
      {
        id: "role-member",
        name: "Member",
        permissions: ["members:view"],
        is_system: true,
        display_order: 1,
      },
      {
        id: "role-pledge",
        name: "New Member",
        permissions: [],
        is_system: false,
        display_order: 2,
      },
    ],
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
  mockPermissions.mockReturnValue(["roles:manage", "chapter-config:manage"]);
}

const tab = () => (
  <SettingsRolesTab
    canManage
    defaultInviteRoleId={null}
    onSaveDefaultInviteRole={mockSaveDefaultRole}
  />
);

describe("SettingsRolesTab", () => {
  beforeEach(primeMocks);

  it("lands on the tier list, and links a tier and a role by URL", async () => {
    const user = userEvent.setup();
    render(tab());
    expect(screen.getByTestId("overview")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "open tier" }));
    expect(mockPush).toHaveBeenCalledWith("/settings?tab=roles&tier=tier-1");
    await user.click(screen.getByRole("button", { name: "open role" }));
    expect(mockPush).toHaveBeenCalledWith("/settings?tab=roles&role=role-1");
  });

  it("opens a tier's permissions from ?tier=, and goes back to the list", async () => {
    const user = userEvent.setup();
    mockParams.value = new URLSearchParams("tab=roles&tier=tier-9");
    render(tab());
    expect(screen.getByTestId("tier-page")).toHaveTextContent("tier-9");
    expect(screen.queryByTestId("overview")).toBeNull();
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(mockPush).toHaveBeenCalledWith("/settings?tab=roles");
  });

  it("opens a role from ?role=", () => {
    mockParams.value = new URLSearchParams("tab=roles&role=role-3");
    render(tab());
    expect(screen.getByTestId("role-page")).toHaveTextContent("role-3");
  });

  it("offers Transfer presidency only to the caller who holds everything", () => {
    const { unmount } = render(tab());
    expect(screen.queryByTestId("transfer")).toBeNull();
    unmount();
    mockPermissions.mockReturnValue(["*"]);
    render(tab());
    expect(screen.getByTestId("transfer")).toBeInTheDocument();
  });

  // ── Default invite role (#422) ───────────────────────────────────────────

  describe("default invite role", () => {
    // This block sits outside `SettingsRolesTab`'s describe, so it primes the
    // mocks itself; without this it only passed on state another test left.
    beforeEach(primeMocks);

    const picker = () => screen.getByRole("combobox", { name: "Role" });

    it("selects the configured role and offers an explicit no-default option", async () => {
      const user = userEvent.setup();
      render(
        <SettingsRolesTab
          canManage
          defaultInviteRoleId="role-pledge"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      const picker = screen.getByRole("combobox", { name: "Role" });
      expect(picker).toHaveTextContent("New Member");
      await user.click(picker);
      expect(
        screen.getByRole("option", { name: /no default/i }),
      ).toBeInTheDocument();
    });

    it("saves the picked role id", async () => {
      const user = userEvent.setup();
      render(
        <SettingsRolesTab
          canManage
          defaultInviteRoleId={null}
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      await user.click(screen.getByRole("combobox", { name: "Role" }));
      await user.click(screen.getByRole("option", { name: "Member" }));
      expect(mockSaveDefaultRole).toHaveBeenCalledWith("role-member");
    });

    /*
     * Clearing writes `null`. The no-default option carries a sentinel value,
     * because a Radix item cannot hold an empty string, so the component has
     * to translate it — the sentinel reaching the API would fail uuid
     * validation with a 400 rather than clearing the setting.
     */
    it("saves null when the default is cleared", async () => {
      const user = userEvent.setup();
      render(
        <SettingsRolesTab
          canManage
          defaultInviteRoleId="role-member"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      await user.click(screen.getByRole("combobox", { name: "Role" }));
      await user.click(screen.getByRole("option", { name: /no default/i }));
      expect(mockSaveDefaultRole).toHaveBeenCalledWith(null);
    });

    it("disables the picker for a caller who cannot manage config", () => {
      render(
        <SettingsRolesTab
          canManage={false}
          defaultInviteRoleId={null}
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      expect(screen.getByRole("combobox", { name: "Role" })).toBeDisabled();
    });

    it("flags a configured role that is no longer in the catalog", () => {
      render(
        <SettingsRolesTab
          canManage
          defaultInviteRoleId="role-deleted"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      expect(
        screen.getByText(/configured default role no longer exists/i),
      ).toBeInTheDocument();
      // The placeholder, not an empty box: Radix draws nothing for a value it
      // has no item for.
      expect(picker()).toHaveTextContent("Pick a role");
    });

    /*
     * With the roles list missing, the only item is "No default". The native
     * select this replaced showed that item as already selected, so picking
     * it wrote nothing; a Radix select holding the configured id would treat
     * the same click as a change and clear a valid default, beside copy that
     * says the default cannot be changed.
     */
    it("locks the picker and keeps the configured default when roles fail to load", async () => {
      const user = userEvent.setup();
      mockUseRoles.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
        isSuccess: false,
        refetch: vi.fn(),
      });
      render(
        <SettingsRolesTab
          canManage
          defaultInviteRoleId="role-pledge"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      expect(picker()).toBeDisabled();
      expect(picker()).toHaveTextContent("Roles could not load");
      await user.click(picker());
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
      expect(mockSaveDefaultRole).not.toHaveBeenCalled();
    });

    it("locks the picker and says so while roles are loading", () => {
      mockUseRoles.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
        isSuccess: false,
        refetch: vi.fn(),
      });
      render(
        <SettingsRolesTab
          canManage
          defaultInviteRoleId="role-pledge"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      expect(picker()).toBeDisabled();
      expect(picker()).toHaveTextContent("Loading roles…");
    });

    it("locks the picker while a config save is in flight", () => {
      render(
        <SettingsRolesTab
          canManage
          defaultInviteRoleId={null}
          onSaveDefaultInviteRole={mockSaveDefaultRole}
          isSavingConfig
        />,
      );
      expect(picker()).toBeDisabled();
    });
  });
});
