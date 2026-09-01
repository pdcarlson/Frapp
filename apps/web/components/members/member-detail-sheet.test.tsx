import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared spy so tests can assert the exact mutation payload the sheet sends.
const updateRolesMutateAsync = vi.fn().mockResolvedValue({});
const { dmMutateAsync, mockRouterPush, mockToast, mockCurrentUserId, mockCurrentUserLoading } =
  vi.hoisted(() => ({
    dmMutateAsync: vi.fn(),
    mockRouterPush: vi.fn(),
    mockToast: vi.fn(),
    // Distinct from every test's member `user_id` ("u1") so the Message
    // button renders by default; self-DM cases override this.
    mockCurrentUserId: { current: "viewer-1" as string | null },
    mockCurrentUserLoading: { current: false },
  }));

// The sheet pulls live data + mutations from @repo/hooks; stub them so the
// component renders from its `member` prop (usingPreviewData bypasses useMember).
vi.mock("@repo/hooks", () => ({
  useMember: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useRoles: () => ({ data: [], isError: false }),
  useRemoveMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateMemberRoles: () => ({ mutateAsync: updateRolesMutateAsync, isPending: false }),
  useGetOrCreateDm: () => ({ mutateAsync: dmMutateAsync, isPending: false }),
  // The custom-roles section is permission-gated; grant everything by default.
  useMyPermissions: () => ({ data: { permissions: ["*"] } }),
  useCustomRoles: () => customRolesState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({
    userId: mockCurrentUserId.current,
    isLoading: mockCurrentUserLoading.current,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Custom-role assignment (bridge model): the list read is stubbed per-test via
// this holder; default mirrors "no custom roles defined".
const customRolesState: {
  data: unknown;
  isSuccess: boolean;
  isError: boolean;
} = { data: [], isSuccess: true, isError: false };

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

describe("MemberDetailSheet Message action", () => {
  beforeEach(() => {
    dmMutateAsync.mockReset();
    mockRouterPush.mockReset();
    mockToast.mockReset();
    mockCurrentUserId.current = "viewer-1";
    mockCurrentUserLoading.current = false;
  });

  it("creates or reuses the DM and navigates to it with the channel selected", async () => {
    dmMutateAsync.mockResolvedValue({ id: "dm-channel-1" });

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        member={baseMember}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /message/i }));

    await waitFor(() =>
      expect(dmMutateAsync).toHaveBeenCalledWith({ member_id: "u1" }),
    );
    expect(mockRouterPush).toHaveBeenCalledWith("/chat?channel=dm-channel-1");
  });

  it("toasts an error rather than navigating when the DM call fails", async () => {
    dmMutateAsync.mockRejectedValue(new Error("network down"));

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        member={baseMember}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /message/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not start conversation",
          description: "network down",
          variant: "destructive",
        }),
      ),
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // Self-DM is not rejected server-side (member_ids: [callerId, callerId] still
  // passes the "exactly 2" check), so the guard has to be here: hide the
  // control entirely rather than let a member start a conversation with
  // themselves.
  it("hides the Message action on the viewer's own row", () => {
    mockCurrentUserId.current = "u1";

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        member={baseMember}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /message/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the Message action in preview mode", () => {
    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData
        member={baseMember}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /message/i }),
    ).not.toBeInTheDocument();
  });

  // Regression for the guard's own loading window: `useFrappUser()` reports
  // `userId: null` until /v1/users/me resolves, so comparing against that
  // null would let the button (and a resulting self-DM) through on the
  // viewer's own row for as long as the load takes.
  it("hides the Message action while the viewer's own id is still loading", () => {
    mockCurrentUserId.current = null;
    mockCurrentUserLoading.current = true;

    render(
      <MemberDetailSheet
        open
        onOpenChange={() => {}}
        usingPreviewData={false}
        member={baseMember}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /message/i }),
    ).not.toBeInTheDocument();
  });

  // Regression: members-directory.tsx keeps a single MemberDetailSheet
  // instance mounted and swaps `member` as rows are opened, so a slow DM
  // request started for one member can resolve after the sheet has already
  // moved to another. That stale continuation must not hijack navigation
  // away from whichever member the viewer is now looking at.
  it("ignores a DM result that resolves after the sheet has moved to a different member", async () => {
    let resolveDm!: (value: unknown) => void;
    dmMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDm = resolve;
        }),
    );

    const onOpenChange = vi.fn();
    const { rerender } = render(
      <MemberDetailSheet
        open
        onOpenChange={onOpenChange}
        usingPreviewData={false}
        member={baseMember}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /message/i }));
    await waitFor(() =>
      expect(dmMutateAsync).toHaveBeenCalledWith({ member_id: "u1" }),
    );

    rerender(
      <MemberDetailSheet
        open
        onOpenChange={onOpenChange}
        usingPreviewData={false}
        member={{ ...baseMember, id: "m2", user_id: "u2" }}
      />,
    );

    await act(async () => {
      resolveDm({ id: "dm-channel-1" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockToast).not.toHaveBeenCalled();
  });
});
