import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// The sheet pulls live data + mutations from @repo/hooks; stub them so the
// component renders from its `member` prop (usingPreviewData bypasses useMember).
vi.mock("@repo/hooks", () => ({
  useMember: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useRoles: () => ({ data: [], isError: false }),
  useRemoveMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMemberRoles: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
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
