import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

const CLASSES = [
  pledgeClass("alpha", "Alpha", 0),
  pledgeClass("beta", "Beta", 1),
];
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
      screen.getByRole("list", { name: "Pledge class" }),
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
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    // The chapter's word, as typed: never "Lines" or "line".
    expect(screen.getByText("Line", { exact: true })).toBeInTheDocument();
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
    expect(mockRename).toHaveBeenCalledWith({
      id: "alpha",
      name: "Alpha 2019",
    });
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
      screen.getByText(/its 2 members are left without one/i),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Delete Alpha",
        hidden: false,
        description: undefined,
      }),
    );
    expect(mockDelete).toHaveBeenCalledWith("alpha");
  });

  it("keeps the handles while a save is in flight, and sends moves made meanwhile as one more save", async () => {
    let finishFirst: () => void = () => {};
    mockReorder.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );
    renderTab();
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), {
      key: "ArrowDown",
    });
    // Still there, and still usable, while the first save is out.
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), {
      key: "ArrowUp",
    });
    expect(mockReorder).toHaveBeenCalledTimes(1);
    finishFirst();
    await waitFor(() => expect(mockReorder).toHaveBeenCalledTimes(2));
    expect(mockReorder).toHaveBeenLastCalledWith(["alpha", "beta"]);
  });

  it("puts the saved order back on screen when the API refuses a move", async () => {
    mockReorder.mockRejectedValue({ statusCode: 409 });
    renderTab();
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), {
      key: "ArrowDown",
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Pledge class" }))
          .getAllByRole("listitem")
          .map((row) => row.textContent),
      ).toEqual(["Alpha2 members", "Beta1 member"]),
    );
  });

  describe("before the roster read answers", () => {
    beforeEach(() => {
      mockMembers.mockReturnValue({
        data: undefined,
        isError: false,
        refetch: vi.fn(),
      });
    });

    it("won't open the class editor, which would start from an empty class", () => {
      renderTab();
      expect(
        screen.getByRole("button", { name: "Edit members of Alpha" }),
      ).toBeDisabled();
    });

    it("doesn't claim a class is empty when deleting it", async () => {
      renderTab();
      await userEvent.click(
        screen.getByRole("button", { name: "Delete Alpha" }),
      );
      expect(screen.queryByText("No members are in it.")).toBeNull();
      expect(
        screen.getByText(/any members in it are left without one/i),
      ).toBeInTheDocument();
    });

    it("says the roster failed and offers the read again", async () => {
      const refetch = vi.fn();
      mockMembers.mockReturnValue({ data: undefined, isError: true, refetch });
      renderTab();
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(refetch).toHaveBeenCalled();
    });
  });

  it("opens the class editor in place of the page beside chat (#4593)", async () => {
    render(
      <div data-tool-column="">
        <div data-tool-page="">
          <SettingsClassesTab
            canManage
            classTerm="Pledge class"
            orderTerm="Fraternal order"
          />
        </div>
      </div>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Edit members of Alpha" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const region = screen.getByRole("region", { name: "Alpha" });
    expect(region.parentElement).toHaveAttribute("data-tool-column");
    await userEvent.click(
      screen.getByRole("button", { name: "Back to Pledge class" }),
    );
    expect(screen.queryByRole("region", { name: "Alpha" })).toBeNull();
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

    it("leaves alone a member another officer added while the editor was open", async () => {
      const view = renderTab();
      await userEvent.click(
        screen.getByRole("button", { name: "Edit members of Alpha" }),
      );
      // A background re-read brings in Dee, now in Alpha.
      mockMembers.mockReturnValue({
        data: [...MEMBERS.slice(0, 3), member("m4", "Dee", "alpha", 3)],
        isError: false,
      });
      view.rerender(
        <SettingsClassesTab
          canManage
          classTerm="Pledge class"
          orderTerm="Fraternal order"
        />,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await userEvent.click(
        screen.getByRole("button", { name: "Remove Ada from Alpha" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(mockAssign).toHaveBeenCalledWith([
        { member_id: "m1", pledge_class_id: null, order_number: 2 },
      ]);
    });

    it("has nothing to save until something changes", async () => {
      await openAlpha();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });
});
