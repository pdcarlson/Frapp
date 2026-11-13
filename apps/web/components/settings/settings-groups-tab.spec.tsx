import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGroups = vi.fn();
const mockMembers = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockSetMembers = vi.fn();
const mockDelete = vi.fn();
const mockToast = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useGroups: () => mockGroups(),
  useMembers: () => mockMembers(),
  useCreateGroup: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateGroup: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useSetGroupMembers: () => ({ mutateAsync: mockSetMembers, isPending: false }),
  useDeleteGroup: () => ({ mutateAsync: mockDelete, isPending: false }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

import { SettingsGroupsTab } from "./settings-groups-tab";

const group = (
  id: string,
  name: string,
  kind: "manual" | "pledge_class" | "class_year",
  member_ids: string[],
  extra: Record<string, unknown> = {},
) => ({
  id,
  chapter_id: "c1",
  kind,
  name,
  color: null,
  mentionable: true,
  pledge_class_id: kind === "pledge_class" ? `pc-${id}` : null,
  class_year: kind === "class_year" ? 2027 : null,
  member_ids,
  created_at: "",
  updated_at: "",
  ...extra,
});

const member = (id: string, display_name: string) => ({
  id: `m-${id}`,
  user_id: id,
  display_name,
});

const GROUPS = [
  group("g-floor", "Third floor", "manual", ["u1"]),
  group("g-alpha", "Alpha", "pledge_class", ["u1", "u2"], {
    mentionable: false,
  }),
];
const MEMBERS = [member("u1", "Ann Lee"), member("u2", "Ben Park")];

function loaded(data: unknown) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  };
}

describe("SettingsGroupsTab (#4076)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroups.mockReturnValue(loaded(GROUPS));
    mockMembers.mockReturnValue(loaded(MEMBERS));
  });

  it("lists manual groups apart from pledge classes and class years, marking the automatic ones", () => {
    render(<SettingsGroupsTab canManage />);
    expect(screen.getByText("Third floor")).toBeTruthy();
    expect(screen.getByText("1 member")).toBeTruthy();
    expect(
      screen.getByText(
        "2 members · Follows pledge class · Only officers can ping it",
      ),
    ).toBeTruthy();
    // A manual group can be deleted; an automatic one cannot.
    expect(
      screen.getByRole("button", { name: "Delete Third floor" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Alpha" })).toBeNull();
  });

  it("offers no writes without groups:manage", () => {
    render(<SettingsGroupsTab canManage={false} />);
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(
      screen.getByText("Only officers who manage groups can change these."),
    ).toBeTruthy();
  });

  it("creates a group and opens it to pick members", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(group("g-new", "Live-ins", "manual", []));
    mockGroups.mockReturnValue(
      loaded([...GROUPS, group("g-new", "Live-ins", "manual", [])]),
    );
    render(<SettingsGroupsTab canManage />);
    await user.type(screen.getByLabelText("Name"), "  Live-ins ");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(mockCreate).toHaveBeenCalledWith({ name: "Live-ins" });
    await waitFor(() =>
      expect(screen.getByLabelText("Add a member")).toBeTruthy(),
    );
  });

  it("saves a manual group's new members as one whole list", async () => {
    const user = userEvent.setup();
    render(<SettingsGroupsTab canManage />);
    await user.click(screen.getByRole("button", { name: "Edit Third floor" }));
    await user.type(screen.getByLabelText("Add a member"), "ben");
    await user.click(screen.getByRole("button", { name: "Add Ben Park" }));
    await user.click(
      screen.getByRole("button", { name: "Remove Ann Lee from Third floor" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetMembers).toHaveBeenCalledWith({
      id: "g-floor",
      memberIds: ["u2"],
    });
  });

  it("lets an automatic group's ping switch change, and not its name or members", async () => {
    const user = userEvent.setup();
    render(<SettingsGroupsTab canManage />);
    await user.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const dialog = screen.getByRole("dialog");
    expect(
      (within(dialog).getByLabelText("Name") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(within(dialog).queryByLabelText("Add a member")).toBeNull();
    await user.click(
      within(dialog).getByRole("switch", {
        name: "Anyone can @mention this group",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: "g-alpha",
      body: { name: undefined, color: undefined, mentionable: true },
    });
    expect(mockSetMembers).not.toHaveBeenCalled();
  });
});
