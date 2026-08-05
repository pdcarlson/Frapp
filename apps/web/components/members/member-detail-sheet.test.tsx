import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared spy so tests can assert the exact mutation payload the sheet sends.
const updateRolesMutateAsync = vi.fn().mockResolvedValue({});

// The sheet pulls live data + mutations from @repo/hooks; stub them so the
// component renders from its `member` prop (usingPreviewData bypasses useMember).
vi.mock("@repo/hooks", () => ({
  useMember: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useRoles: () => ({ data: [], isError: false }),
  useRemoveMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMemberRoles: () => ({ mutateAsync: updateRolesMutateAsync, isPending: false }),
  // The custom-roles section is permission-gated; grant everything by default.
  useMyPermissions: () => ({ data: { permissions: ["*"] } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Custom-role assignment (bridge model): the list read is stubbed per-test via
// this holder; default mirrors "no custom roles defined".
const customRolesState: {
  data: unknown;
  isSuccess: boolean;
  isError: boolean;
} = { data: [], isSuccess: true, isError: false };

vi.mock("@/lib/hooks/use-custom-roles", () => ({
  useCustomRoles: () => customRolesState,
}));

import { MemberDetailSheet } from "./member-detail-sheet";

const baseMember = {
  id: "m1",
  user_id: "u1",
  display_name: "Jane Smith",
  email: "jane@example.com",
  has_completed_onboarding: true,
  created_at: "2026-01-15T00:00:00Z",
  role_ids: [],
};

describe("MemberDetailSheet custom fields", () => {
  it("renders server-provided custom fields with typed value formatting", () => {
    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        points={142}
        member={{
          ...baseMember,
          custom_fields: [
            { field_id: "f1", key: "major", label: "Major", type: "text", visibility: "chapter", value: "Computer Science" },
            { field_id: "f2", key: "hometown", label: "Hometown", type: "text", visibility: "chapter", value: null },
            { field_id: "f3", key: "dues_paid", label: "Dues Paid", type: "boolean", visibility: "exec", value: "true" },
          ],
        }}
      />,
    );

    expect(screen.getByText("Custom fields")).toBeInTheDocument();
    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    // Boolean values render as Yes/No.
    expect(screen.getByText("Dues Paid")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    // Points render (including the falsy-safe number path).
    expect(screen.getByText("142")).toBeInTheDocument();
    // An unset value shows an em dash rather than being dropped.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("omits the custom-fields section when the server returns none", () => {
    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        member={{ ...baseMember, custom_fields: [] }}
      />,
    );

    expect(screen.queryByText("Custom fields")).not.toBeInTheDocument();
  });
});

describe("MemberDetailSheet custom roles", () => {
  it("renders assignable custom roles with the member's assignment pre-checked", () => {
    customRolesState.data = [
      { id: "cr1", key: "historian", label: "Historian", rank: 5, capabilities: [], core: false },
      { id: "cr2", key: "social_chair", label: "Social Chair", rank: 6, capabilities: [], core: false },
    ];
    customRolesState.isSuccess = true;

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        member={{ ...baseMember, custom_role_ids: ["cr1"] }}
      />,
    );

    expect(screen.getByText("Custom roles")).toBeInTheDocument();
    expect(screen.getByText("Historian")).toBeInTheDocument();
    expect(screen.getByText("Social Chair")).toBeInTheDocument();

    const historianRow = screen.getByText("Historian").closest("label");
    expect(historianRow).not.toBeNull();
    expect(historianRow!.querySelector("input")!.checked).toBe(true);

    const socialRow = screen.getByText("Social Chair").closest("label");
    expect(socialRow!.querySelector("input")!.checked).toBe(false);
  });

  it("omits the custom-roles section when the chapter has none", () => {
    customRolesState.data = [];
    customRolesState.isSuccess = true;

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        member={{ ...baseMember }}
      />,
    );

    expect(screen.queryByText("Custom roles")).not.toBeInTheDocument();
  });

  it("omits the custom-roles section when the list cannot load (no config access)", () => {
    customRolesState.data = undefined;
    customRolesState.isSuccess = false;
    customRolesState.isError = true;

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        member={{ ...baseMember }}
      />,
    );

    expect(screen.queryByText("Custom roles")).not.toBeInTheDocument();
  });
});

describe("MemberDetailSheet save payload", () => {
  beforeEach(() => {
    updateRolesMutateAsync.mockClear();
  });

  it("sends the selection as-is, including ids of since-deleted roles", async () => {
    customRolesState.data = [
      { id: "cr1", key: "historian", label: "Historian", rank: 5, capabilities: [], core: false },
    ];
    customRolesState.isSuccess = true;
    customRolesState.isError = false;

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        // cr-deleted no longer exists in the chapter catalog. It is still sent
        // (the server exempts held ids) — filtering against the possibly-stale
        // catalog would silently strip freshly assigned roles instead.
        member={{ ...baseMember, custom_role_ids: ["cr-deleted"] }}
      />,
    );

    const historianRow = screen.getByText("Historian").closest("label");
    fireEvent.click(historianRow!.querySelector("input")!);
    fireEvent.click(screen.getByRole("button", { name: "Save role changes" }));

    await waitFor(() => expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateRolesMutateAsync).toHaveBeenCalledWith({
      id: "m1",
      role_ids: [],
      custom_role_ids: ["cr-deleted", "cr1"],
    });
  });

  it("omits custom_role_ids entirely when the list could not load", async () => {
    customRolesState.data = undefined;
    customRolesState.isSuccess = false;
    customRolesState.isError = true;

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        member={{ ...baseMember, custom_role_ids: ["cr1"] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save role changes" }));

    await waitFor(() => expect(updateRolesMutateAsync).toHaveBeenCalledTimes(1));
    // Omission tells the server "leave the assignment unchanged" — the sheet
    // must never strip custom roles it could not display.
    expect(updateRolesMutateAsync).toHaveBeenCalledWith({
      id: "m1",
      role_ids: [],
    });
  });
});
