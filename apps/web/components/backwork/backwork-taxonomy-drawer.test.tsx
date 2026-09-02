import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BackworkTaxonomyDrawer } from "./backwork-taxonomy-drawer";

const {
  mockToast,
  departmentsData,
  professorsData,
  mockUpdateDepartment,
  mockDeleteDepartment,
  mockMergeDepartments,
  mockUpdateProfessor,
  mockDeleteProfessor,
  mockMergeProfessors,
} = vi.hoisted(() => ({
  mockToast: vi.fn(),
  departmentsData: {
    value: [
      { id: "dept-1", code: "CHEM", name: "Chemistry" },
      { id: "dept-2", code: "MATH", name: "Mathematics" },
    ] as unknown[],
  },
  professorsData: {
    value: [{ id: "prof-1", name: "Dr. Rivera" }] as unknown[],
  },
  mockUpdateDepartment: vi.fn().mockResolvedValue({}),
  mockDeleteDepartment: vi.fn().mockResolvedValue({}),
  mockMergeDepartments: vi.fn().mockResolvedValue({ reassigned: 3 }),
  mockUpdateProfessor: vi.fn().mockResolvedValue({}),
  mockDeleteProfessor: vi.fn().mockResolvedValue({}),
  mockMergeProfessors: vi.fn().mockResolvedValue({ reassigned: 1 }),
}));

vi.mock("@repo/hooks", () => ({
  useDepartments: () => ({ data: departmentsData.value }),
  useProfessors: () => ({ data: professorsData.value }),
  useUpdateDepartment: () => ({ mutateAsync: mockUpdateDepartment }),
  useDeleteDepartment: () => ({ mutateAsync: mockDeleteDepartment }),
  useMergeDepartments: () => ({ mutateAsync: mockMergeDepartments }),
  useUpdateProfessor: () => ({ mutateAsync: mockUpdateProfessor }),
  useDeleteProfessor: () => ({ mutateAsync: mockDeleteProfessor }),
  useMergeProfessors: () => ({ mutateAsync: mockMergeProfessors }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  departmentsData.value = [
    { id: "dept-1", code: "CHEM", name: "Chemistry" },
    { id: "dept-2", code: "MATH", name: "Mathematics" },
  ];
  professorsData.value = [{ id: "prof-1", name: "Dr. Rivera" }];
});

async function openDrawer() {
  const user = userEvent.setup();
  render(<BackworkTaxonomyDrawer />);
  await user.click(
    screen.getByRole("button", { name: /manage taxonomy/i }),
  );
  return user;
}

describe("BackworkTaxonomyDrawer", () => {
  it("lists existing departments and professors", async () => {
    await openDrawer();

    expect(screen.getByText("Chemistry")).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Dr. Rivera")).toBeInTheDocument();
  });

  it("renames a department", async () => {
    const user = await openDrawer();

    await user.click(screen.getByRole("button", { name: /rename chemistry/i }));
    const input = screen.getByDisplayValue("Chemistry");
    await user.clear(input);
    await user.type(input, "Chem & Biochem{Enter}");

    await waitFor(() => {
      expect(mockUpdateDepartment).toHaveBeenCalledWith({
        id: "dept-1",
        body: { name: "Chem & Biochem" },
      });
    });
  });

  it("does not save an unchanged or blank name", async () => {
    const user = await openDrawer();

    await user.click(screen.getByRole("button", { name: /rename chemistry/i }));
    const input = screen.getByDisplayValue("Chemistry");
    await user.clear(input);
    await user.keyboard("{Enter}");

    expect(mockUpdateDepartment).not.toHaveBeenCalled();
  });

  it("re-opening rename shows the current name, not a stale draft from an earlier abandoned edit", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BackworkTaxonomyDrawer />);
    await user.click(
      screen.getByRole("button", { name: /manage taxonomy/i }),
    );

    // Open the edit, type something, then cancel without saving — `draft`
    // now holds abandoned text that must not resurface later.
    await user.click(screen.getByRole("button", { name: /rename chemistry/i }));
    await user.clear(screen.getByDisplayValue("Chemistry"));
    await user.type(screen.getByRole("textbox"), "abandoned edit");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(mockUpdateDepartment).not.toHaveBeenCalled();

    // Another admin renames it server-side; the list refetches with the new name.
    departmentsData.value = [
      { id: "dept-1", code: "CHEM", name: "Chem & Biochem" },
      { id: "dept-2", code: "MATH", name: "Mathematics" },
    ];
    rerender(<BackworkTaxonomyDrawer />);

    // Re-opening edit must show the current server name, not "abandoned edit".
    await user.click(
      screen.getByRole("button", { name: /rename chem & biochem/i }),
    );
    expect(screen.getByDisplayValue("Chem & Biochem")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("abandoned edit")).not.toBeInTheDocument();
  });

  it("deletes a professor after confirming", async () => {
    const user = await openDrawer();

    await user.click(
      screen.getByRole("button", { name: /delete dr\. rivera/i }),
    );
    // The shared confirm-dialog replaces window.confirm; its own button reads
    // the confirmLabel passed in ("Delete").
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^delete$/i }),
    );

    await waitFor(() => {
      expect(mockDeleteProfessor).toHaveBeenCalledWith("prof-1");
    });
  });

  it("does not disable the delete control merely because the confirmation dialog is open", async () => {
    const user = await openDrawer();

    const deleteButton = screen.getByRole("button", {
      name: /delete dr\. rivera/i,
    });
    await user.click(deleteButton);
    await screen.findByRole("dialog");

    // No mutation has been requested yet — the row's own button must not
    // read as "in progress" for a decision the user hasn't made.
    expect(mockDeleteProfessor).not.toHaveBeenCalled();
    expect(deleteButton).not.toBeDisabled();
  });

  it("cancelling the confirmation dialog never calls delete", async () => {
    const user = await openDrawer();

    await user.click(
      screen.getByRole("button", { name: /delete dr\. rivera/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^cancel$/i }),
    );

    expect(mockDeleteProfessor).not.toHaveBeenCalled();
  });

  it("surfaces the server's block-while-referenced error via toast rather than silently failing", async () => {
    mockDeleteDepartment.mockRejectedValueOnce(
      new Error("Cannot delete: 3 resource(s) still reference this department."),
    );
    const user = await openDrawer();

    await user.click(
      screen.getByRole("button", { name: /delete chemistry/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^delete$/i }),
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Unable to delete",
          variant: "destructive",
        }),
      );
    });
  });

  it("opens the merge dialog naming the source, offering every other entry as a target", async () => {
    const user = await openDrawer();

    await user.click(screen.getByRole("button", { name: /merge chemistry/i }));

    expect(
      screen.getByText(/merge "chemistry"/i),
    ).toBeInTheDocument();
    // Merge is disabled until a target is picked.
    expect(screen.getByRole("button", { name: /^merge$/i })).toBeDisabled();
  });
});
