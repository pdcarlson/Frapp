import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkMock } from "@/tests/network";

/**
 * The first tests this file has ever had.
 *
 * `roles-page.tsx` is 604 lines carrying the presidency transfer, the wildcard
 * lock, and two destructive confirmations, and nothing in the suite rendered
 * it: `settings-roles-tab.test.tsx` mocks the whole module out, so the Live
 * roles sub-tab was never mounted by any test. The Settings & Roles slice
 * rewrote its state branches, its checkboxes and both confirmations, which is
 * a lot of change to land on an unpinned file.
 *
 * What is pinned here is what the slice changed or could have broken, not the
 * screen's whole surface: the branch order (permission before network before
 * data), the offline state that did not exist, the confirmations that replaced
 * `window.confirm`, and the wildcard rule the API enforces on the other side.
 */

const {
  mockOffline,
  roles,
  catalog,
  deleteRole,
  transferPresidency,
  currentChapter,
  presidencyClaimStatus,
  claimPresidency,
} = vi.hoisted(() => ({
  mockOffline: { value: false },
  roles: {
    data: undefined as unknown,
    isPending: true,
    isLoading: true,
    isError: false,
    fetchStatus: "fetching" as string,
  },
  catalog: {
    data: undefined as unknown,
    isPending: true,
    isLoading: true,
    isError: false,
    fetchStatus: "fetching" as string,
  },
  deleteRole: { mutateAsync: vi.fn(), isPending: false },
  transferPresidency: { mutateAsync: vi.fn(), isPending: false },
  // Defaults to "this chapter has a President" so the pre-existing tests
  // below render the page exactly as before — the claim banner opts itself
  // out via `needs_president: false`.
  currentChapter: {
    data: { needs_president: false } as { needs_president: boolean } | undefined,
  },
  presidencyClaimStatus: {
    data: undefined as
      | { needs_president: boolean; eligible: boolean; next_role_name: string | null }
      | undefined,
    isLoading: false,
    isError: false,
  },
  claimPresidency: { mutateAsync: vi.fn(), isPending: false },
}));

const permissions = { value: ["roles:manage"] as string[] };

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@repo/hooks", () => ({
  useRoles: () => ({ ...roles, refetch: vi.fn() }),
  usePermissionsCatalog: () => ({ ...catalog, refetch: vi.fn() }),
  useMembers: () => ({ data: [], isPending: false, isError: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => deleteRole,
  useTransferPresidency: () => transferPresidency,
  useCurrentChapter: () => currentChapter,
  usePresidencyClaimStatus: () => presidencyClaimStatus,
  useClaimPresidency: () => claimPresidency,
  useMyPermissions: () => ({
    data: { permissions: permissions.value },
    isPending: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: "chapter-1" }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { RolesAndPermissionsPage } from "@/components/roles/roles-page";

const SYSTEM_ROLE = {
  id: "r1",
  name: "President",
  permissions: ["*"],
  is_system: true,
  display_order: 1,
  color: null,
};
const CUSTOM_ROLE = {
  id: "r2",
  name: "Philanthropy Chair",
  permissions: ["members:view"],
  is_system: false,
  display_order: 2,
  color: null,
};

function settled() {
  Object.assign(roles, {
    data: [SYSTEM_ROLE, CUSTOM_ROLE],
    isPending: false,
    isLoading: false,
    isError: false,
    fetchStatus: "idle",
  });
  Object.assign(catalog, {
    data: [
      { permission: "members:view", key: "View members" },
      { permission: "*", key: "Everything" },
    ],
    isPending: false,
    isLoading: false,
    isError: false,
    fetchStatus: "idle",
  });
}

beforeEach(() => {
  mockOffline.value = false;
  permissions.value = ["roles:manage"];
  deleteRole.mutateAsync.mockReset().mockResolvedValue(undefined);
  transferPresidency.mutateAsync.mockReset().mockResolvedValue(undefined);
  claimPresidency.mutateAsync.mockReset().mockResolvedValue(undefined);
  claimPresidency.isPending = false;
  Object.assign(currentChapter, { data: { needs_president: false } });
  Object.assign(presidencyClaimStatus, {
    data: undefined,
    isLoading: false,
    isError: false,
  });
  settled();
});

describe("permission, then network, then data", () => {
  it("does not tell an unpermitted member the roles are loading", () => {
    // The defect: `isPending` and `isError` early-returned *above* the gate,
    // so a member without `roles:manage` who reached this route by URL was
    // told the roles were loading, then that they had failed, for a surface
    // they were never going to see.
    permissions.value = [];
    Object.assign(roles, { isPending: true, isLoading: true, data: undefined });
    render(<RolesAndPermissionsPage />);
    expect(screen.queryByText(/loading roles and permissions/i)).toBeNull();
    expect(screen.getByText(/requires the/i)).toBeInTheDocument();
  });

  it("shows the offline state, which this screen did not have", () => {
    mockOffline.value = true;
    Object.assign(roles, {
      data: undefined,
      isPending: true,
      isLoading: false,
      fetchStatus: "paused",
    });
    render(<RolesAndPermissionsPage />);
    expect(screen.getByText(/roles unavailable offline/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading roles/i)).toBeNull();
  });

  it("keeps a rendered roster through a blip rather than blanking it", () => {
    // `isOffline` alone would throw away rows TanStack is still holding.
    mockOffline.value = true;
    Object.assign(roles, { fetchStatus: "paused", isPending: false });
    render(<RolesAndPermissionsPage />);
    expect(screen.getByText("Philanthropy Chair")).toBeInTheDocument();
    expect(screen.queryByText(/unavailable offline/i)).toBeNull();
  });

  it("treats a query that is pending but idle as neither loading nor offline", () => {
    Object.assign(roles, {
      data: undefined,
      isPending: true,
      isLoading: false,
      fetchStatus: "idle",
    });
    render(<RolesAndPermissionsPage />);
    expect(screen.queryByText(/loading roles and permissions/i)).toBeNull();
  });
});

describe("the confirmations that replaced window.confirm", () => {
  it("deletes a role only after an in-product confirmation", async () => {
    const user = userEvent.setup();
    render(<RolesAndPermissionsPage />);
    await user.click(
      screen.getByRole("button", { name: /delete philanthropy chair/i }),
    );
    expect(deleteRole.mutateAsync).not.toHaveBeenCalled();
    // Verb plus object, never a bare "Confirm" — `writing.md` §2, and it also
    // keeps this query unambiguous against the row's own Delete control.
    await user.click(screen.getByRole("button", { name: /^delete role$/i }));
    await waitFor(() => expect(deleteRole.mutateAsync).toHaveBeenCalledWith("r2"));
  });

  it("abandons the delete when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    render(<RolesAndPermissionsPage />);
    await user.click(
      screen.getByRole("button", { name: /delete philanthropy chair/i }),
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(deleteRole.mutateAsync).not.toHaveBeenCalled();
  });

  it("never reaches for the browser's own dialog", () => {
    const nativeConfirm = vi.fn();
    vi.stubGlobal("confirm", nativeConfirm);
    render(<RolesAndPermissionsPage />);
    expect(nativeConfirm).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("offers no delete on a system role", () => {
    render(<RolesAndPermissionsPage />);
    expect(screen.queryByRole("button", { name: /delete president/i })).toBeNull();
  });
});

describe("the wildcard the API will not let the client move", () => {
  it("locks it on a system role rather than hiding the row", async () => {
    const user = userEvent.setup();
    render(<RolesAndPermissionsPage />);
    await user.click(screen.getByRole("button", { name: /president/i }));
    const wildcard = screen
      .getAllByRole("checkbox")
      .find((box) => box.getAttribute("disabled") !== null);
    expect(wildcard).toBeDefined();
  });
});

describe("an open confirmation survives a state change", () => {
  it("is not unmounted when a background refetch fails mid-dialog", async () => {
    /*
     * The invariant the whole `window.confirm` conversion rests on, and the
     * one the review found unpinned: `{confirmDialog}` sits above the state
     * branch so a query flipping to error or offline cannot take the dialog
     * with it. `ConfirmDialogHost` settles a pending promise `null` on
     * unmount, so the failure mode is silent — the member's click on "Delete
     * role" simply stops existing, with no toast and no error.
     *
     * `window.confirm` could not fail this way: it blocks the thread, so no
     * re-render could land while it was open. That is the cost the conversion
     * introduces, which is why it needs a test rather than a comment.
     *
     * Verified by moving `{confirmDialog}` inside the loaded branch and
     * watching this fail while the other nine stayed green.
     */
    const user = userEvent.setup();
    const view = render(<RolesAndPermissionsPage />);
    await user.click(
      screen.getByRole("button", { name: /delete philanthropy chair/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // A background refetch fails with the roster still cached — v5 keeps
    // `data` and flips `status` to error, which is the reachable shape.
    Object.assign(roles, { isError: true });
    view.rerender(<RolesAndPermissionsPage />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^delete role$/i }));
    await waitFor(() =>
      expect(deleteRole.mutateAsync).toHaveBeenCalledWith("r2"),
    );
  });
});

// #349: the orphan-president recovery flow (spec/behavior/rbac.md §
// Presidency Transfer "Edge case"). The banner renders OUTSIDE the
// `roles:manage` gate, so every test here exercises that placement directly
// by leaving `permissions.value` at its default `["roles:manage"]` OR
// explicitly emptying it — both must still show the banner.
describe("the orphan-president claim banner", () => {
  it("renders nothing when the chapter has a President", () => {
    Object.assign(currentChapter, { data: { needs_president: false } });
    render(<RolesAndPermissionsPage />);
    expect(screen.queryByText(/needs a new president/i)).toBeNull();
  });

  it("is visible to a member without roles:manage — the point of rendering outside the gate", () => {
    permissions.value = [];
    Object.assign(currentChapter, { data: { needs_president: true } });
    Object.assign(presidencyClaimStatus, {
      data: { needs_president: true, eligible: true, next_role_name: "Treasurer" },
      isLoading: false,
    });
    render(<RolesAndPermissionsPage />);
    expect(screen.getByText(/needs a new president/i)).toBeInTheDocument();
    // The gated body underneath still shows its denied fallback.
    expect(screen.getByText(/requires the/i)).toBeInTheDocument();
  });

  it("offers a claim button and names the eligible role when the caller is eligible", () => {
    Object.assign(currentChapter, { data: { needs_president: true } });
    Object.assign(presidencyClaimStatus, {
      data: { needs_president: true, eligible: true, next_role_name: "Treasurer" },
      isLoading: false,
    });
    render(<RolesAndPermissionsPage />);
    expect(screen.getByText(/treasurer/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /claim presidency/i }),
    ).toBeInTheDocument();
  });

  it("names the eligible role but offers no claim button when the caller is ineligible", () => {
    Object.assign(currentChapter, { data: { needs_president: true } });
    Object.assign(presidencyClaimStatus, {
      data: { needs_president: true, eligible: false, next_role_name: "Treasurer" },
      isLoading: false,
    });
    render(<RolesAndPermissionsPage />);
    expect(screen.getByText(/treasurer/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim presidency/i }),
    ).toBeNull();
  });

  it("shows a retry-able error rather than the support message when the status fetch fails", () => {
    // A failed fetch and a genuine "no eligible role" result must not read
    // the same — the former is retry-able, the latter tells a real officer
    // to contact support over a transient network blip.
    Object.assign(currentChapter, { data: { needs_president: true } });
    Object.assign(presidencyClaimStatus, {
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<RolesAndPermissionsPage />);
    expect(screen.getByText(/couldn't check who can claim it/i)).toBeInTheDocument();
    expect(screen.queryByText(/contact frapp support/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /claim presidency/i }),
    ).toBeNull();
  });

  it("directs to Frapp support when no eligible role exists", () => {
    Object.assign(currentChapter, { data: { needs_president: true } });
    Object.assign(presidencyClaimStatus, {
      data: { needs_president: true, eligible: false, next_role_name: null },
      isLoading: false,
    });
    render(<RolesAndPermissionsPage />);
    expect(screen.getByText(/contact frapp support/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim presidency/i }),
    ).toBeNull();
  });

  it("claims the presidency only after an in-product confirmation", async () => {
    const user = userEvent.setup();
    Object.assign(currentChapter, { data: { needs_president: true } });
    Object.assign(presidencyClaimStatus, {
      data: { needs_president: true, eligible: true, next_role_name: "Treasurer" },
      isLoading: false,
    });
    render(<RolesAndPermissionsPage />);

    await user.click(screen.getByRole("button", { name: /claim presidency/i }));
    expect(claimPresidency.mutateAsync).not.toHaveBeenCalled();

    // Scoped to the dialog: its confirm button shares the trigger's exact
    // label ("Claim presidency"), same as this screen's existing
    // transfer-presidency confirmation.
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /claim presidency/i }),
    );
    await waitFor(() => expect(claimPresidency.mutateAsync).toHaveBeenCalled());
  });
});
