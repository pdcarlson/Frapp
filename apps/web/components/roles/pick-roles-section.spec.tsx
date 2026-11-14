import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  roles: [] as Array<{ id: string; name: string; held: boolean; color: null }>,
  isLoading: false,
  mutateAsync: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  usePickableRoles: () => ({ roles: h.roles, isLoading: h.isLoading }),
  useSetPickedRole: () => ({ mutateAsync: h.mutateAsync }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: h.toast }),
}));

import { PickRolesSection } from "./pick-roles-section";

beforeEach(() => {
  h.roles = [
    { id: "im", name: "Intramurals", held: true, color: null },
    { id: "study", name: "Study group", held: false, color: null },
  ];
  h.isLoading = false;
  h.mutateAsync.mockReset().mockResolvedValue({ role_ids: [] });
  h.toast.mockReset();
});

describe("PickRolesSection (#4958)", () => {
  it("draws one switch per role, on for the roles held", () => {
    render(<PickRolesSection />);
    expect(screen.getByText("Your roles")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Leave Intramurals" }),
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Join Study group" }),
    ).not.toBeChecked();
  });

  it("joins and leaves through the API", async () => {
    render(<PickRolesSection />);
    fireEvent.click(screen.getByRole("switch", { name: "Join Study group" }));
    await waitFor(() =>
      expect(h.mutateAsync).toHaveBeenCalledWith({ id: "study", join: true }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Leave Intramurals" }));
    await waitFor(() =>
      expect(h.mutateAsync).toHaveBeenCalledWith({ id: "im", join: false }),
    );
  });

  it("says so when a pick is refused", async () => {
    h.mutateAsync.mockRejectedValueOnce(new Error("nope"));
    render(<PickRolesSection />);
    fireEvent.click(screen.getByRole("switch", { name: "Join Study group" }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't join Study group",
          variant: "destructive",
        }),
      ),
    );
  });

  it("shows nothing in a chapter with no roles to pick, or while loading", () => {
    h.roles = [];
    const { container, rerender } = render(<PickRolesSection />);
    expect(container).toBeEmptyDOMElement();
    h.roles = [{ id: "im", name: "Intramurals", held: false, color: null }];
    h.isLoading = true;
    rerender(<PickRolesSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
