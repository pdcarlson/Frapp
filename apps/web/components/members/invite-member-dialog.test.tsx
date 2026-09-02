import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { beyondGrace, chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockOrgConfig, mockRoles } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockOrgConfig: vi.fn(),
  mockRoles: vi.fn(),
}));

const INVITE = {
  id: "inv-1",
  token: "ABC123",
  role: "Member",
  expires_at: "2026-12-01T00:00:00Z",
  used_at: null,
};

vi.mock("@repo/hooks", () => ({
  useRoles: () => mockRoles(),
  useOrgConfig: () => mockOrgConfig(),
  useInvites: () => ({ data: [INVITE], isError: false }),
  useCreateInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBatchCreateInvites: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["billing:manage"] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { InviteMemberDialog } = await import("./invite-member-dialog");

const chapter = chapterSubscription(mockCurrentChapter);

async function openDialog() {
  render(<InviteMemberDialog trigger={<button>Invite</button>} />);
  await userEvent.click(screen.getByRole("button", { name: /^invite$/i }));
}

const generate = () => screen.getByRole("button", { name: /generate/i });
const revoke = () => screen.getByRole("button", { name: /revoke/i });

/**
 * `POST /invites` and `POST /invites/batch` are the repo's only two
 * `@FreeTier` + `@GraceBlocked` routes (`invite.controller.ts:46,60`). That
 * combination behaves unlike anything else in the entitlement sweep, and it is
 * the case #841's acceptance criteria call out by name: free-tier writes keep
 * working during the `past_due` grace window, and only invites are blocked.
 */
/** Default hook state every test starts from; individual tests override. */
function primeHooks() {
  mockRoles.mockReturnValue({
    data: [{ id: "r1", name: "Member" }],
    isError: false,
  });
  mockOrgConfig.mockReturnValue({ data: {}, isError: false });
}

describe("InviteMemberDialog subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHooks();
  });

  it("keeps invites available on an incomplete chapter", async () => {
    // The distinguishing case. A `paid` control is blocked here; these routes
    // are `@FreeTier`, so gating them on `incomplete` would lock a chapter out
    // of the very recruiting it needs to grow before it converts.
    chapter.incomplete();
    await openDialog();

    expect(generate()).toBeEnabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("blocks invites by name inside the past_due grace window", async () => {
    chapter.pastDue();
    await openDialog();

    expect(generate()).toBeDisabled();
    expect(screen.getByText(/new invites are blocked/i)).toBeInTheDocument();
  });

  it("leaves revoke live during grace — only invites are blocked", async () => {
    // The other half of the same acceptance criterion. `DELETE /invites/:id`
    // carries the class-level `@FreeTier` without `@GraceBlocked`, so a chapter
    // inside grace can still withdraw a token it already issued.
    chapter.pastDue();
    await openDialog();

    expect(revoke()).toBeEnabled();
  });

  it("locks invites once the grace window closes", async () => {
    chapter.pastDue(beyondGrace());
    await openDialog();

    expect(generate()).toBeDisabled();
    // Revoke locks here too — `@FreeTier` survives grace, not past it — so both
    // notices render the same sentence.
    expect(revoke()).toBeDisabled();
    expect(
      screen.getAllByText(/write actions are blocked/i).length,
    ).toBeGreaterThan(0);
  });

  it("blocks invites on a canceled chapter", async () => {
    // `canceled` is checked above the free-tier carve-out in the guard, so a
    // naive "free-tier means always allowed" mapping gets this one wrong.
    chapter.canceled();
    await openDialog();

    expect(generate()).toBeDisabled();
    // `canceled` is checked above the free-tier carve-out, so revoke goes too.
    expect(revoke()).toBeDisabled();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
  });

  it("leaves everything alone on an active chapter", async () => {
    chapter.active();
    await openDialog();

    expect(generate()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", async () => {
    chapter.unreadable();
    await openDialog();

    expect(generate()).toBeEnabled();
  });
});

/**
 * #422. The picker used to seed `"Member"` and then snap to
 * `roleOptions[0]` — the *alphabetically first* role — whenever Member was
 * absent from the catalog. That made the effective default arbitrary, which is
 * what this issue reported.
 */
describe("InviteMemberDialog default role", () => {
  const ROLES = [
    { id: "role-alumni", name: "Alumni" },
    { id: "role-member", name: "Member" },
    { id: "role-pledge", name: "New Member" },
  ];

  const rolePicker = () => screen.getByRole("combobox") as HTMLSelectElement;

  beforeEach(() => {
    vi.clearAllMocks();
    primeHooks();
    chapter.active();
  });

  it("pre-selects the chapter's configured default invite role", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    await openDialog();

    expect(rolePicker().value).toBe("New Member");
  });

  /*
   * The regression that motivated tracking the choice separately. The roles
   * query and the config query resolve independently; when roles land first
   * the picker settles on a valid-but-arbitrary role, and a correction keyed
   * on "is the current value broken?" never fires because it is not broken —
   * it is merely wrong. Simulated here by the config arriving as a second
   * render with roles already present.
   */
  it("adopts the default when the config query resolves after the roles query", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({ data: undefined, isError: false });
    await openDialog();
    // The no-default fallback, and not what the chapter configured.
    expect(rolePicker().value).toBe("Member");

    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    // Any state change re-renders the dialog, which re-reads the (now
    // resolved) config hook — the same sequence a settled query produces,
    // without needing a real query client.
    await userEvent.type(screen.getByRole("spinbutton"), "2");

    expect(rolePicker().value).toBe("New Member");
  });

  it("keeps an explicit pick over the configured default", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    await openDialog();
    await userEvent.selectOptions(rolePicker(), "Alumni");

    expect(rolePicker().value).toBe("Alumni");
  });

  /*
   * The regression guard. `roleOptions` is sorted alphabetically, so seeding
   * the picker off `roleOptions[0]` pre-selects **Alumni** on every chapter
   * that has not configured a default — which is all of them, since the column
   * ships null with no backfill. That would hand new members the alumni
   * lifecycle restrictions instead of Member, reintroducing the arbitrary
   * default #422 exists to remove. Member must win whenever it is in the
   * catalog, exactly as it did before this field existed.
   */
  it("falls back to Member, not the alphabetically first role, when no default is configured", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({ data: {}, isError: false });
    await openDialog();

    expect(rolePicker().value).toBe("Member");
  });

  it("falls back to the first role only when the catalog has no Member role", async () => {
    mockRoles.mockReturnValue({
      data: [
        { id: "role-alumni", name: "Alumni" },
        { id: "role-pledge", name: "New Member" },
      ],
      isError: false,
    });
    mockOrgConfig.mockReturnValue({ data: {}, isError: false });
    await openDialog();

    expect(rolePicker().value).toBe("Alumni");
  });

  /*
   * `GET /chapters/:id/config` needs `chapter-config:view`, while the dialog
   * needs only `members:invite` — so a delegated recruitment officer can get a
   * 403 here. Degrading to Member (not to whatever sorts first) keeps that
   * failure boring.
   */
  it("degrades to Member when the config query fails", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({ data: undefined, isError: true });
    await openDialog();

    expect(rolePicker().value).toBe("Member");
  });

  it("re-adopts the default after the dialog is closed with Done", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-pledge" },
      isError: false,
    });
    await openDialog();
    await userEvent.selectOptions(rolePicker(), "Alumni");
    expect(rolePicker().value).toBe("Alumni");

    // Done sets state directly rather than going through Radix's dismiss
    // path, so it is the close route most likely to skip the reset.
    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(rolePicker().value).toBe("New Member");
  });

  /*
   * `on delete set null` clears a deleted role's id server-side, but a client
   * holding a stale config read can still name one the catalog no longer has.
   * Falling through to the existing behaviour beats rendering a select whose
   * value matches no option, which React logs and browsers resolve by
   * silently selecting the first entry anyway.
   */
  it("ignores a configured default that no longer exists", async () => {
    mockRoles.mockReturnValue({ data: ROLES, isError: false });
    mockOrgConfig.mockReturnValue({
      data: { default_invite_role_id: "role-deleted" },
      isError: false,
    });
    await openDialog();

    expect(rolePicker().value).toBe("Member");
  });
});
