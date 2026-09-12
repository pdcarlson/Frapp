import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChapterCustomRole } from "@repo/validation";

// Mock the data hooks so the tab renders without a query client / network.
const mockUseCustomRoles = vi.fn();
const mockUseRoles = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSaveDefaultRole = vi.fn();
const mockUseCatalog = vi.fn();
const mockUseMembers = vi.fn();
const mockUpdateRole = vi.fn();
const mockPermissions = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCustomRoles: () => mockUseCustomRoles(),
  useRoles: () => mockUseRoles(),
  useCreateCustomRole: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateCustomRole: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteCustomRole: () => ({ mutateAsync: mockDelete, isPending: false }),
  // The `4e` matrix reads these three directly, so the tab renders even when
  // the chapter-config call is refused.
  usePermissionsCatalog: () => mockUseCatalog(),
  useMembers: () => mockUseMembers(),
  useUpdateRole: () => ({ mutateAsync: mockUpdateRole, isPending: false }),
  // The matrix reads `roles:manage` itself rather than taking the tab's
  // `canManage` (which is `chapter-config:manage`) — the API guards
  // `PATCH /v1/roles/:id` on the former.
  useMyPermissions: () => ({
    data: { permissions: mockPermissions() },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

// The folded-in live RBAC manager pulls in @repo/hooks; stub it out.
vi.mock("@/components/roles/roles-page", () => ({
  RolesAndPermissionsPage: () => <div data-testid="live-roles" />,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { SettingsRolesTab } from "./settings-roles-tab";

const CATALOG = [
  { key: "MEMBERS_VIEW", permission: "members:view" },
  { key: "EVENTS_CREATE", permission: "events:create" },
];

function customRole(over: Partial<ChapterCustomRole> = {}): ChapterCustomRole {
  return {
    id: "r1",
    chapter_id: "c1",
    key: "pledge_educator",
    label: "Pledge Educator",
    rank: 9,
    capabilities: ["members:view"],
    core: false,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("SettingsRolesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCustomRoles.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
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
    mockUseCatalog.mockReturnValue({
      data: CATALOG,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseMembers.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      isSuccess: true,
    });
    mockUpdateRole.mockResolvedValue({});
    mockPermissions.mockReturnValue(["roles:manage", "chapter-config:manage"]);
  });

  it("names the role pack in the header rather than as a view of its own", () => {
    // `4e` draws the pack as a label beside the count. It used to be the
    // default sub-tab, so `?tab=roles` landed on a read-only list of archetype
    // names and the editor was two clicks further in.
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    expect(screen.getByRole("heading", { name: "Roles" })).toBeInTheDocument();
    expect(screen.getByText(/role pack/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /pack/i })).not.toBeInTheDocument();
  });

  it("draws one row per permission and one column per live role", () => {
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    // Columns are the `roles` table, not the archetype pack — the old matrix
    // drew pack columns it had no capability data for and filled them with the
    // literal string "n/a".
    expect(
      screen.getByRole("columnheader", { name: "Member, 0 members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "New Member, 0 members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("rowheader", { name: "MEMBERS_VIEW" }),
    ).toBeInTheDocument();
    // Rows group by permission namespace (`4e` pin 3).
    expect(screen.getByRole("rowheader", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Events" })).toBeInTheDocument();
    expect(screen.queryByText("n/a")).not.toBeInTheDocument();
  });

  it("shows no member count at all when the members read has not landed", () => {
    // Not "0". An officer auditing who holds the President role would read a
    // zero as a fact, and act on it.
    mockUseMembers.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
    });
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Member" })).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /0 members/ }),
    ).not.toBeInTheDocument();
  });

  it("flips a cell straight to the API, with no Save step", async () => {
    // `4e` pin 2: "Click flips and saves". The permission it sends is the
    // role's existing set plus the one clicked — never the whole catalog.
    const user = userEvent.setup();
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "EVENTS_CREATE for Member" }),
    );

    expect(mockUpdateRole).toHaveBeenCalledWith({
      id: "role-member",
      body: { permissions: ["members:view", "events:create"] },
    });
  });

  it("composes a second flip on top of the first, not on top of stale props", async () => {
    /*
     * The race the optimistic overlay exists for. `useUpdateRole`'s
     * `onSuccess` fires `invalidateQueries` without returning it, so
     * `mutateAsync` resolves before the refetched roles arrive — the `roles`
     * prop here never changes at all, standing in for that window. Without the
     * overlay the second PATCH would rebuild from the original
     * `["members:view"]` and silently drop the grant the first one made.
     */
    const user = userEvent.setup();
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "EVENTS_CREATE for Member" }),
    );
    await user.click(
      screen.getByRole("button", { name: "MEMBERS_VIEW for Member" }),
    );

    expect(mockUpdateRole).toHaveBeenNthCalledWith(1, {
      id: "role-member",
      body: { permissions: ["members:view", "events:create"] },
    });
    // The revoke is applied to the array the first call sent, so
    // `events:create` survives.
    expect(mockUpdateRole).toHaveBeenNthCalledWith(2, {
      id: "role-member",
      body: { permissions: ["events:create"] },
    });
  });

  it("locks every cell of a role holding the wildcard", () => {
    // The API rejects introducing or stripping `*` outside presidency
    // transfer, so a clickable cell there is a control that always fails.
    mockUseRoles.mockReturnValue({
      data: [
        {
          id: "role-president",
          name: "President",
          permissions: ["*"],
          is_system: true,
          display_order: 0,
        },
      ],
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );

    expect(screen.queryByRole("button", { name: /for President/ })).not.toBeInTheDocument();
    // And it reads as granted rather than empty.
    expect(screen.getByText("Granted: MEMBERS_VIEW for President")).toBeInTheDocument();
  });

  it("never renders the wildcard as a permission row", () => {
    render(
      <SettingsRolesTab
        archetypeKey="ifc"
        canManage
        catalog={[{ key: "WILDCARD", permission: "*" }, ...CATALOG]}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    expect(screen.queryByRole("rowheader", { name: "WILDCARD" })).not.toBeInTheDocument();
  });

  it("leaves the cells read-only for a caller who cannot manage roles", () => {
    // `roles:manage` specifically. A caller holding `chapter-config:manage`
    // alone must not get live cells: every click would 403.
    mockPermissions.mockReturnValue(["chapter-config:manage"]);
    render(
      <SettingsRolesTab
        archetypeKey="ifc"
        canManage={false}
        catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    expect(screen.queryByRole("button", { name: /for Member/ })).not.toBeInTheDocument();
    expect(screen.getByText("Granted: MEMBERS_VIEW for Member")).toBeInTheDocument();
  });

  it("hides the delete control for core roles and shows it for non-core", async () => {
    mockUseCustomRoles.mockReturnValue({
      data: [
        customRole({ id: "core1", label: "Core Role", core: true }),
        customRole({ id: "free1", label: "Free Role", core: false }),
      ],
      isPending: false,
      isError: false,
    });
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /delete core role/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete free role/i }),
    ).toBeInTheDocument();
  });

  it("creates a custom role with the drafted key, label, and capabilities", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({});
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    await user.type(screen.getByLabelText("Key"), "social_chair");
    await user.type(screen.getByLabelText("Label"), "Social Chair");
    await user.click(screen.getByLabelText("new role events:create"));
    await user.click(screen.getByRole("button", { name: /create role/i }));

    expect(mockCreate).toHaveBeenCalledWith({
      key: "social_chair",
      label: "Social Chair",
      rank: 99,
      capabilities: ["events:create"],
    });
  });

  it("disables custom-role editing controls when the caller cannot manage", async () => {
    render(
      <SettingsRolesTab
        archetypeKey="ifc"
        canManage={false}
        catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    expect(screen.getByLabelText("Key")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /create role/i }),
    ).toBeDisabled();
  });

  it("never offers the wildcard as a capability checkbox", async () => {
    const catalogWithWildcard = [
      { key: "WILDCARD", permission: "*" },
      ...CATALOG,
    ];
    mockUseCustomRoles.mockReturnValue({
      data: [customRole()],
      isPending: false,
      isError: false,
    });
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={catalogWithWildcard}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );

    // The API rejects `*` on custom roles (400), so the chip must not render —
    // neither on existing roles nor in the create form.
    expect(
      screen.queryByRole("checkbox", { name: /Pledge Educator \*/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "new role *" }),
    ).not.toBeInTheDocument();
    // Ordinary capabilities still render for both.
    expect(
      screen.getByRole("checkbox", { name: "Pledge Educator members:view" }),
    ).toBeInTheDocument();
  });

  it("strips a legacy wildcard from the payload when toggling capabilities", async () => {
    const user = userEvent.setup();
    // Pre-bridge rows can still carry `*`; echoing it back would 400 forever.
    mockUseCustomRoles.mockReturnValue({
      data: [customRole({ capabilities: ["*", "members:view"] })],
      isPending: false,
      isError: false,
    });
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />,
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Pledge Educator events:create" }),
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      id: "r1",
      body: { capabilities: ["members:view", "events:create"] },
    });
  });
});

describe("the capability matrix's marks, at the call site", () => {
  /*
   * `settings-contrast.spec.ts` measures the tones; it cannot see which one
   * the component reaches for. The review proved the gap: reverting the
   * missing-permission mark to `text-muted` — the exact near-miss that file's
   * docstring is written about, 3.568:1 and under §6 — left all of its
   * assertions and all of this file's green. Same lesson as the accent-painted
   * status one slice back: a value-level guard is blind to the call site.
   */
  it("uses the token pair the measurements clear, not the one that reads right", () => {
    render(<SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG}
        defaultInviteRoleId={null}
        onSaveDefaultInviteRole={mockSaveDefaultRole}
      />);

    // The cells that carry the mark: one granted, one not, both on a role
    // whose cells are editable so the tone lives on the button.
    const marks = [
      screen.getByRole("button", { name: "MEMBERS_VIEW for Member" }),
      screen.getByRole("button", { name: "EVENTS_CREATE for Member" }),
    ];
    for (const mark of marks) {
      const { className } = mark;
      // `--muted` is 3.568:1 on this card, and the marks are characters, so
      // §6's 4.5:1 text floor applies rather than the 3:1 glyph one.
      expect(className).not.toMatch(/text-muted(?![-\w])/);
      /*
       * No opacity modifier on the tone, in *either* Tailwind spelling. The
       * first cut of this guard banned `text-muted-foreground/40` literally,
       * and the review walked straight past it with
       * `text-muted-foreground/[.4]` — the identical 2.184:1 the whole file
       * exists to prevent, reached through the bracket syntax. Checking which
       * token is only half the question; a correct token at 40% is the same
       * defect. This caught `text-muted-foreground/60` on the first cut of the
       * `4e` matrix.
       */
      expect(className).not.toMatch(/text-(accent-text|muted-foreground)\//);
      expect(className).not.toMatch(/emerald|green-\d/);
      expect(className).not.toMatch(/\bdark:/);
    }
    // Granted takes the retinting accent, not `--success`: a held permission
    // is an entitlement, not a status (`pro-chip.tsx`). And not `--gold-ask-*`,
    // which is Ask's fixed family and must never merge into the accent.
    expect(marks[0]!.className).toContain("text-accent-text");
    expect(marks[0]!.className).not.toContain("gold-ask");
    expect(marks[1]!.className).toContain("text-muted-foreground");
  });

  // ── Default invite role (#422) ───────────────────────────────────────────

  describe("default invite role", () => {
    it("selects the configured role and offers an explicit no-default option", () => {
      render(
        <SettingsRolesTab
          archetypeKey="ifc"
          canManage
          catalog={CATALOG}
          defaultInviteRoleId="role-pledge"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      const select = screen.getByLabelText("Role") as HTMLSelectElement;
      expect(select.value).toBe("role-pledge");
      expect(
        screen.getByRole("option", { name: /no default/i }),
      ).toBeInTheDocument();
    });

    it("saves the picked role id", async () => {
      const user = userEvent.setup();
      render(
        <SettingsRolesTab
          archetypeKey="ifc"
          canManage
          catalog={CATALOG}
          defaultInviteRoleId={null}
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      await user.selectOptions(screen.getByLabelText("Role"), "role-member");
      expect(mockSaveDefaultRole).toHaveBeenCalledWith("role-member");
    });

    /*
     * Clearing writes `null`, not `""`. The select's no-default option carries
     * an empty string value because that is the only thing a native <option>
     * can hold, so the component has to translate it — and `""` reaching the
     * API would fail uuid validation with a 400 rather than clearing the
     * setting.
     */
    it("saves null when the default is cleared", async () => {
      const user = userEvent.setup();
      render(
        <SettingsRolesTab
          archetypeKey="ifc"
          canManage
          catalog={CATALOG}
          defaultInviteRoleId="role-member"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      await user.selectOptions(screen.getByLabelText("Role"), "");
      expect(mockSaveDefaultRole).toHaveBeenCalledWith(null);
    });

    it("disables the picker for a caller who cannot manage config", () => {
      render(
        <SettingsRolesTab
          archetypeKey="ifc"
          canManage={false}
          catalog={CATALOG}
          defaultInviteRoleId={null}
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      expect(screen.getByLabelText("Role")).toBeDisabled();
    });

    it("flags a configured role that is no longer in the catalog", () => {
      render(
        <SettingsRolesTab
          archetypeKey="ifc"
          canManage
          catalog={CATALOG}
          defaultInviteRoleId="role-deleted"
          onSaveDefaultInviteRole={mockSaveDefaultRole}
        />,
      );
      expect(
        screen.getByText(/configured default role no longer exists/i),
      ).toBeInTheDocument();
    });
  });
});
