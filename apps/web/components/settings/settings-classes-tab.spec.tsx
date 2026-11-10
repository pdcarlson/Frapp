import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClasses = vi.fn();
const mockMembers = vi.fn();
const mockCreate = vi.fn();
const mockRename = vi.fn();
const mockReorder = vi.fn();
const mockDelete = vi.fn();
const mockAssign = vi.fn();
const mockToast = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePledgeClasses: () => mockClasses(),
  useMembers: () => mockMembers(),
  useCreatePledgeClass: () => ({ mutateAsync: mockCreate, isPending: false }),
  useRenamePledgeClass: () => ({ mutateAsync: mockRename, isPending: false }),
  useReorderPledgeClasses: () => ({
    mutateAsync: mockReorder,
    isPending: false,
  }),
  useDeletePledgeClass: () => ({ mutateAsync: mockDelete, isPending: false }),
  useAssignPledgeClasses: () => ({ mutateAsync: mockAssign, isPending: false }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

import { SettingsClassesTab } from "./settings-classes-tab";

const pledgeClass = (id: string, name: string, position: number) => ({
  id,
  chapter_id: "c1",
  name,
  position,
  created_at: "",
  updated_at: "",
});

const member = (
  id: string,
  display_name: string,
  pledge_class_id: string | null,
  order_number: number | null,
) => ({ id, user_id: `u-${id}`, display_name, pledge_class_id, order_number });

const CLASSES = [pledgeClass("alpha", "Alpha", 0), pledgeClass("beta", "Beta", 1)];
const MEMBERS = [
  member("m1", "Ada", "alpha", 2),
  member("m2", "Ben", "alpha", 1),
  member("m3", "Cal", "beta", 1),
  member("m4", "Dee", null, null),
];

function renderTab(canManage = true) {
  return render(
    <SettingsClassesTab
      canManage={canManage}
      classTerm="Pledge class"
      orderTerm="Fraternal order"
    />,
  );
}

describe("SettingsClassesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClasses.mockReturnValue({
      data: CLASSES,
      isPending: false,
      isLoading: false,
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    mockMembers.mockReturnValue({ data: MEMBERS, isError: false });
    mockReorder.mockResolvedValue(undefined);
    mockAssign.mockResolvedValue(undefined);
  });

  it("lists the chapter's classes oldest first, each with its member count", () => {
    renderTab();
    const rows = within(
      screen.getByRole("list", { name: "Pledge classes" }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Alpha2 members",
      "Beta1 member",
    ]);
  });

  it("says so when the chapter has none, in the chapter's word", () => {
    mockClasses.mockReturnValue({
      data: [],
      isPending: false,
      isLoading: false,
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn(),
    });
    render(
      <SettingsClassesTab canManage classTerm="Line" orderTerm="Line number" />,
    );
    expect(screen.getByText(/no lines yet/i)).toBeInTheDocument();
    expect(screen.getByText("Add a line")).toBeInTheDocument();
  });

  it("adds a class by name", async () => {
    mockCreate.mockResolvedValue(undefined);
    renderTab();
    await userEvent.type(screen.getByLabelText("Name"), "  Gamma ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mockCreate).toHaveBeenCalledWith("Gamma");
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
  });

  it("renames a class in place", async () => {
    mockRename.mockResolvedValue(undefined);
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Rename Alpha" }));
    const field = screen.getByLabelText("Name of Alpha");
    await userEvent.clear(field);
    await userEvent.type(field, "Alpha 2019{Enter}");
    expect(mockRename).toHaveBeenCalledWith({ id: "alpha", name: "Alpha 2019" });
  });

  it("saves the whole list when a class is moved", async () => {
    renderTab();
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), {
      key: "ArrowDown",
    });
    await waitFor(() =>
      expect(mockReorder).toHaveBeenCalledWith(["beta", "alpha"]),
    );
  });

  it("says the order was not saved when the API refuses it", async () => {
    mockReorder.mockRejectedValue({ statusCode: 409 });
    renderTab();
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), {
      key: "ArrowDown",
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Couldn't save the order" }),
      ),
    );
  });

  it("asks before deleting, and says the members keep their number", async () => {
    mockDelete.mockResolvedValue(undefined);
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(
      screen.getByText(/2 members will have no pledge class/i),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete pledge class" }),
    );
    expect(mockDelete).toHaveBeenCalledWith("alpha");
  });

  it("offers no editing to a viewer without roles:manage", () => {
    renderTab(false);
    expect(screen.queryByRole("button", { name: /reorder/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rename/i })).toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  describe("class editor", () => {
    async function openAlpha() {
      renderTab();
      await userEvent.click(
        screen.getByRole("button", { name: "Edit members of Alpha" }),
      );
      return screen.getByRole("list", { name: "Members of Alpha" });
    }

    it("lists the class's members in fraternal order", async () => {
      const list = await openAlpha();
      expect(
        within(list)
          .getAllByRole("textbox")
          .map((field) => [
            field.getAttribute("aria-label"),
            (field as HTMLInputElement).value,
          ]),
      ).toEqual([
        ["Fraternal order for Ben", "1"],
        ["Fraternal order for Ada", "2"],
      ]);
    });

    it("renumbers on a move and saves only what changed, in one request", async () => {
      await openAlpha();
      fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Ben" }), {
        key: "ArrowDown",
      });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(mockAssign).toHaveBeenCalledWith([
        { member_id: "m1", pledge_class_id: "alpha", order_number: 1 },
        { member_id: "m2", pledge_class_id: "alpha", order_number: 2 },
      ]);
    });

    it("adds a member from another class and says where they move from", async () => {
      await openAlpha();
      await userEvent.type(screen.getByLabelText("Add a member"), "ca");
      expect(screen.getByText("Moves from Beta")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Add Cal" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(mockAssign).toHaveBeenCalledWith([
        { member_id: "m3", pledge_class_id: "alpha", order_number: 3 },
      ]);
    });

    it("takes a member out of the class and keeps their number", async () => {
      await openAlpha();
      await userEvent.click(
        screen.getByRole("button", { name: "Remove Ada from Alpha" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(mockAssign).toHaveBeenCalledWith([
        { member_id: "m1", pledge_class_id: null, order_number: 2 },
      ]);
    });

    it("refuses to save a number the API would refuse", async () => {
      await openAlpha();
      const field = screen.getByLabelText("Fraternal order for Ben");
      await userEvent.clear(field);
      await userEvent.type(field, "0");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/whole number/i);
    });

    it("has nothing to save until something changes", async () => {
      await openAlpha();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });
});
