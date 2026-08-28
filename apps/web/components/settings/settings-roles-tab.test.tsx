import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChapterCustomRole } from "@repo/validation";

// Mock the data hooks so the tab renders without a query client / network.
const mockUseCustomRoles = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCustomRoles: () => mockUseCustomRoles(),
  useCreateCustomRole: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateCustomRole: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteCustomRole: () => ({ mutateAsync: mockDelete, isPending: false }),
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
  });

  it("renders the role pack (read-only) from the active archetype", () => {
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG} />,
    );
    // Pack sub-tab is the default; ifc_standard includes President.
    expect(screen.getByText("President")).toBeInTheDocument();
  });

  it("derives matrix columns from the pack plus live custom roles", async () => {
    const user = userEvent.setup();
    mockUseCustomRoles.mockReturnValue({
      data: [customRole({ label: "Pledge Educator" })],
      isPending: false,
      isError: false,
    });
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG} />,
    );
    await user.click(screen.getByRole("tab", { name: /matrix/i }));
    // A pack column and the custom-role column are both present as headers.
    expect(
      screen.getByRole("columnheader", { name: "President" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Pledge Educator" }),
    ).toBeInTheDocument();
    // The capability the custom role holds is reflected in the matrix.
    expect(
      screen.getByLabelText("Pledge Educator has members:view"),
    ).toBeInTheDocument();
  });

  it("hides the delete control for core roles and shows it for non-core", async () => {
    const user = userEvent.setup();
    mockUseCustomRoles.mockReturnValue({
      data: [
        customRole({ id: "core1", label: "Core Role", core: true }),
        customRole({ id: "free1", label: "Free Role", core: false }),
      ],
      isPending: false,
      isError: false,
    });
    render(
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG} />,
    );
    await user.click(screen.getByRole("tab", { name: /custom/i }));
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
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG} />,
    );
    await user.click(screen.getByRole("tab", { name: /custom/i }));
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
    const user = userEvent.setup();
    render(
      <SettingsRolesTab
        archetypeKey="ifc"
        canManage={false}
        catalog={CATALOG}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /custom/i }));
    expect(screen.getByLabelText("Key")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /create role/i }),
    ).toBeDisabled();
  });

  it("never offers the wildcard as a capability checkbox", async () => {
    const user = userEvent.setup();
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
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={catalogWithWildcard} />,
    );
    await user.click(screen.getByRole("tab", { name: /custom/i }));

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
      <SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG} />,
    );
    await user.click(screen.getByRole("tab", { name: /custom/i }));
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
   * `settings-contrast.test.ts` measures the tones; it cannot see which one
   * the component reaches for. The review proved the gap: reverting the
   * missing-permission mark to `text-muted` — the exact near-miss that file's
   * docstring is written about, 3.568:1 and under §6 — left all of its
   * assertions and all of this file's green. Same lesson as the accent-painted
   * status one slice back: a value-level guard is blind to the call site.
   */
  it("uses the token pair the measurements clear, not the one that reads right", async () => {
    const user = userEvent.setup();
    mockUseCustomRoles.mockReturnValue({
      data: [customRole({ label: "Pledge Educator" })],
      isPending: false,
      isError: false,
    });
    render(<SettingsRolesTab archetypeKey="ifc" canManage catalog={CATALOG} />);
    await user.click(screen.getByRole("tab", { name: /matrix/i }));

    const marks = [
      screen.getByLabelText("Pledge Educator has members:view"),
      screen.getByLabelText("Pledge Educator lacks events:create"),
    ];
    for (const mark of marks) {
      const { className } = mark;
      // `--muted` is 3.568:1 on this card, and `✓`/`—` are characters, so
      // §6's 4.5:1 text floor applies rather than the 3:1 glyph one.
      expect(className).not.toMatch(/text-muted(?![-\w])/);
      /*
       * No opacity modifier on the tone, in *either* Tailwind spelling. The
       * first cut of this guard banned `text-muted-foreground/40` literally,
       * and the review walked straight past it with
       * `text-muted-foreground/[.4]` — the identical 2.184:1 the whole file
       * exists to prevent, reached through the bracket syntax. Checking which
       * token is only half the question; a correct token at 40% is the same
       * defect. `text-success/50` measures 2.64:1 and would have passed too.
       */
      expect(className).not.toMatch(/text-(success|muted-foreground)\//);
      // #916's raw palette green beside `--success`, and the dead variant it
      // travelled with — Signet is dark-only, so `dark:` never applied.
      expect(className).not.toMatch(/emerald|green-\d/);
      expect(className).not.toMatch(/\bdark:/);
      expect(className).toMatch(/\btext-(success|muted-foreground)\b/);
    }
    expect(marks[0]!.className).toContain("text-success");
    expect(marks[1]!.className).toContain("text-muted-foreground");
  });
});
