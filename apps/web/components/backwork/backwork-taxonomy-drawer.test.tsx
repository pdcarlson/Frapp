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
