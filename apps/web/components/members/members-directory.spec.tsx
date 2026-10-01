import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { networkMock } from "@/tests/network";

/**
 * The greenfield Directory lane's acceptance, pinned.
 *
 * `members-directory.tsx` had **no** test file before this one, which is the
 * same gap lane 2 closed for the shell (`dashboard-shell.spec.tsx`) when it
 * rewrote it. The cases below are deliberately about the things
 * [`spec/ui/web-dashboard/README.md`](../../../../spec/ui/web-dashboard/README.md)
 * § Page grammar and § Directory claim — a card that is gone, a table that is
 * gone, a row that is now the control, and one empty state that became three —
 * rather than about the
 * layout in general. A suite that asserted the whole render would go red on
 * every future restyle without telling anyone which rule broke.
 */

const { mockOffline, mutateRoles } = vi.hoisted(() => ({
  mockOffline: { value: false },
  mutateRoles: vi.fn(),
}));

type Read = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

function read(data: unknown = []): Read {
  return { data, isLoading: false, isError: false, refetch: vi.fn() };
}

const MEMBERS = [
  {
    id: "m-1",
    user_id: "u-1",
    chapter_id: "chap-1",
    role_ids: ["r-1"],
    has_completed_onboarding: true,
    created_at: "2024-08-14T00:00:00.000Z",
    updated_at: "2024-08-14T00:00:00.000Z",
    display_name: "Ada Lovelace",
    avatar_url: null,
    bio: null,
    graduation_year: 2026,
    current_city: null,
    current_company: null,
    email: "ada@example.test",
  },
  {
    // No role and an unparseable join date: the two fields that used to render
    // an em dash. They must now be absent from the meta line, not dashed.
    id: "m-2",
    user_id: "u-2",
    chapter_id: "chap-1",
    role_ids: [],
    has_completed_onboarding: false,
    created_at: "not-a-date",
    updated_at: "not-a-date",
    display_name: "Grace Hopper",
    avatar_url: null,
    bio: null,
    graduation_year: 2027,
    current_city: null,
    current_company: null,
    email: "grace@example.test",
  },
];

const membersRead = read(MEMBERS);
const searchRead = read([]);
const rolesRead = read([
  { id: "r-1", name: "Treasurer", is_system: false, permissions: [] },
]);
const leaderboardRead = read([{ user_id: "u-1", total: 42 }]);

vi.mock("@repo/hooks", () => ({
  useMembers: () => membersRead,
  useMemberSearch: (q: string) => (q ? searchRead : membersRead),
  useRoles: () => rolesRead,
  useLeaderboard: () => leaderboardRead,
  useOrgConfig: () => ({ data: undefined }),
  useUpdateMemberRoles: () => ({ mutateAsync: mutateRoles, isPending: false }),
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@/lib/providers/chapter-presence-provider", () => ({
  useChapterPresenceContext: () => ({
    isReady: true,
    statusOf: () => "online",
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/**
 * Stubbed because it fires six invite hooks this file's `@repo/hooks` mock has
 * no business knowing about. What matters here is only that the trigger sits in
 * the toolbar row, above the list *and* above every empty state — which is what
 * lets those states carry no CTA of their own.
 */
vi.mock("@/components/members/invite-member-dialog", () => ({
  InviteMemberDialog: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="invite-trigger">{trigger}</div>
  ),
}));

vi.mock("@/components/members/member-detail-sheet", () => ({
  MemberDetailSheet: ({
    open,
    member,
  }: {
    open: boolean;
    member: { display_name?: string } | null;
  }) =>
    open ? (
      <div data-testid="detail-sheet">{member?.display_name ?? "none"}</div>
    ) : null,
}));

import { MembersDirectory } from "@/components/members/members-directory";
import { cardFilledContainers } from "@/tests/card-surfaces";

beforeEach(() => {
  vi.clearAllMocks();
  mockOffline.value = false;
  Object.assign(membersRead, read(MEMBERS));
  Object.assign(searchRead, read([]));
  Object.assign(
    rolesRead,
    read([{ id: "r-1", name: "Treasurer", is_system: false, permissions: [] }]),
  );
  Object.assign(leaderboardRead, read([{ user_id: "u-1", total: 42 }]));
});

describe("Directory on the greenfield shell", () => {
  it("renders the roster as a flush list, with no table and no wrapper card", () => {
    const { container } = render(<MembersDirectory />);

    // The `<Table>` is gone, not hidden: no grid roles survive anywhere.
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);

    // The list carries the shared divider recipe and nothing else — no card
    // fill, no hairline box, no zebra.
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("divide-y");
    expect(list?.className).toContain("border-t");
    expect(list?.querySelectorAll("li")).toHaveLength(MEMBERS.length);
    expect(cardFilledContainers(container)).toHaveLength(0);

    // The card titles the wrappers carried are gone with them. `PageHeader`
    // owns the route's only heading and it lives one component up.
    expect(screen.queryByText("Members Directory")).toBeNull();
    expect(screen.queryByText("Member Records")).toBeNull();
    expect(
      screen.queryByText(/Search and review chapter membership records/),
    ).toBeNull();
  });

  it("keeps the row at 36px on a pointer and 44px on touch", () => {
    const { container } = render(<MembersDirectory />);
    const row = container.querySelector("li");
    expect(row?.className).toContain("min-h-9");
    // §2's touch floor, via the carve-out `denseRowControlClassName` uses.
    expect(row?.className).toContain("pointer-coarse:min-h-11");
  });

  it("makes the row itself the control that opens a member", async () => {
    const user = userEvent.setup();
    render(<MembersDirectory />);

    // The trailing "View details" button is deleted; the row is named for the
    // member and everything the row shows.
    expect(screen.queryByRole("button", { name: /view details/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Ada Lovelace,/ }));
    expect(screen.getByTestId("detail-sheet")).toHaveTextContent(
      "Ada Lovelace",
    );
  });

  it("drops an absent field from the meta line instead of rendering an em dash", () => {
    const { container } = render(<MembersDirectory />);

    // Grace has no role and an unparseable join date. Neither may appear as a
    // placeholder glyph, and no rendered text on the route may contain one.
    expect(container.textContent).not.toContain("—");
    // Ada is the positive control: without it, a matcher that silently never
    // matches would make the negative assertion below pass for free.
    expect(
      screen.getByRole("button", { name: /^Ada Lovelace,/ }),
    ).toHaveAccessibleName(/joined/i);
    const grace = screen.getByRole("button", { name: /^Grace Hopper,/ });
    expect(grace).not.toHaveAccessibleName(/joined/i);
    expect(grace).not.toHaveAccessibleName(/Treasurer/);
  });

  it("labels a member whose name is only whitespace with the shared fallback", () => {
    // `display_name` is NOT NULL DEFAULT '', and spaces are as unset as ''.
    // The label is the one the leaderboard and chat use for this member
    // (`Member <first six of id>`, #2422), so an officer comparing surfaces
    // sees one person, not two.
    Object.assign(
      membersRead,
      read([
        MEMBERS[0],
        {
          ...MEMBERS[1],
          id: "m-3",
          user_id: "2f4a1c9d-0000-4000-8000-000000000000",
          display_name: "   ",
        },
      ]),
    );
    render(<MembersDirectory />);

    expect(
      screen.getByRole("button", { name: /^Member 2f4a1c,/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Member 2f4a1c9d/)).toBeNull();
  });

  it("answers an empty roster, a filtered miss and a search miss differently", async () => {
    const user = userEvent.setup();

    Object.assign(membersRead, read([]));
    const { unmount } = render(<MembersDirectory />);
    expect(screen.getByText("No actives yet")).toBeInTheDocument();
    // The state carries no CTA because the toolbar row above it still does.
    expect(screen.getByTestId("invite-trigger")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("heading", { name: "Actives" }).closest("section")!,
      ).queryByRole("button", { name: /invite/i }),
    ).not.toBeNull();
    unmount();

    // A filter that matches nothing is not a claim about the roster.
    Object.assign(membersRead, read(MEMBERS));
    render(<MembersDirectory />);
    await user.selectOptions(
      screen.getByLabelText("Filter members by status"),
      "pending",
    );
    await user.selectOptions(
      screen.getByLabelText("Filter members by role"),
      "r-1",
    );
    expect(
      screen.getByText("No actives match the filters"),
    ).toBeInTheDocument();
  });

  it("names the query when a search matches nothing", async () => {
    const user = userEvent.setup();
    render(<MembersDirectory />);

    await user.type(screen.getByLabelText("Search members"), "pigg");

    // The board's no-results state names what was asked for, rather than
    // reusing the empty state's claim about the roster.
    expect(await screen.findByText(/No match for/)).toHaveTextContent("pigg");
    expect(screen.queryByText("No actives yet")).toBeNull();
  });

  it("lets an async state replace the sheet rather than strand it on a missing member", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MembersDirectory />);

    await user.click(screen.getByRole("button", { name: /^Ada Lovelace,/ }));
    expect(screen.getByTestId("detail-sheet")).toHaveTextContent(
      "Ada Lovelace",
    );

    // A background refetch fails while the sheet is open. The sheet goes with
    // the body, which is the shape every other `useConfirmDialog` caller has:
    // `ConfirmDialogHost` settles a pending confirmation to `null` on unmount
    // (`confirm-dialog.spec.tsx`, "resolves null when the caller stops
    // rendering the dialog"), so there is no promise left hanging. Keeping it
    // mounted is what would hurt — the list it was opened from is not on
    // screen in exactly these branches, so the sheet would outlive the body it
    // belongs to, with a Save the member can no longer see the result of.
    Object.assign(leaderboardRead, read([]), { isError: true });
    rerender(<MembersDirectory />);

    expect(
      screen.getByText("Couldn't load roles and points"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("detail-sheet")).toBeNull();
  });

  it("sorts members with no role, and with an unparseable join date, last in both directions", async () => {
    const user = userEvent.setup();
    render(<MembersDirectory />);
    const rows = () =>
      screen
        .getAllByRole("button", { name: /Lovelace|Hopper/ })
        .map((el) => el.getAttribute("aria-label")?.split(",")[0]);

    // Grace has no role. A sentinel string inside the comparator would put her
    // last ascending and FIRST descending; the partition keeps her last in both.
    await user.selectOptions(screen.getByLabelText("Sort members"), "role:asc");
    expect(rows()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    await user.selectOptions(
      screen.getByLabelText("Sort members"),
      "role:desc",
    );
    expect(rows()).toEqual(["Ada Lovelace", "Grace Hopper"]);

    // Grace's `created_at` is "not-a-date". Subtracting it yields NaN, and a
    // comparator returning NaN reads as "equal to everything" — not an ordering.
    await user.selectOptions(
      screen.getByLabelText("Sort members"),
      "joined:desc",
    );
    expect(rows()).toEqual(["Ada Lovelace", "Grace Hopper"]);
    await user.selectOptions(
      screen.getByLabelText("Sort members"),
      "joined:asc",
    );
    expect(rows()).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("draws its async states without repainting the card the lane deleted", () => {
    Object.assign(membersRead, read([]), { isError: true });
    const { container } = render(<MembersDirectory />);

    expect(screen.getByText("Couldn't load members")).toBeInTheDocument();
    // `NestedError`, not `ErrorState`: the whole-screen family paints
    // `--card` on its box, which would put back the wrapper this lane just
    // removed. The Retry button inside it may still be Secondary.
    expect(cardFilledContainers(container)).toHaveLength(0);
  });

  it("replaces the four sortable column headers with one sort control", () => {
    render(<MembersDirectory />);
    const sort = screen.getByLabelText("Sort members");
    // Every (key, direction) pair the deleted headers could reach.
    expect(within(sort).getAllByRole("option")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /sort by name/i })).toBeNull();
  });

  it("keeps bulk selection reachable without a checkbox column", async () => {
    const user = userEvent.setup();
    render(<MembersDirectory />);

    const selectAll = () =>
      screen.getByRole("checkbox", {
        name: /select all members on this page/i,
      });

    // Select-all is rendered from zero, not conditioned on its own output. The
    // bulk bar is what appears on selection; the control that drives it must
    // not live inside the thing it can unmount.
    expect(selectAll()).toBeInTheDocument();
    expect(screen.queryByText(/selected$/)).toBeNull();

    await user.click(selectAll());
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByLabelText("Select role to assign")).toBeInTheDocument();

    // Unticking it empties the selection — and the control survives, so focus
    // is not dropped to <body> mid-interaction.
    await user.click(selectAll());
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(selectAll()).toBeInTheDocument();
  });
});

/**
 * #2484 — a chapter with alumni. `GET /v1/members` and its search return the
 * whole chapter; alumni are the Alumni tab's, so the Actives list, its count
 * and its cohort filter leave them out.
 */
describe("Actives on a chapter with alumni", () => {
  const ALUMNUS = {
    ...MEMBERS[0],
    id: "m-3",
    user_id: "u-3",
    role_ids: ["r-alumni"],
    display_name: "Charles Whitmore III",
    graduation_year: 2019,
    email: "charles@example.test",
    is_alumni: true,
  };
  const CHAPTER = [
    { ...MEMBERS[0], is_alumni: false },
    { ...MEMBERS[1], is_alumni: false },
    ALUMNUS,
  ];

  it("lists and counts only the members who are not alumni", () => {
    Object.assign(membersRead, read(CHAPTER));
    const { container } = render(<MembersDirectory />);

    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(screen.queryByText("Charles Whitmore III")).toBeNull();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    // The alumnus's class year is not an Actives cohort.
    expect(screen.queryByRole("option", { name: /2019/ })).toBeNull();
  });

  it("searches both tabs, since it is the web directory's only name search", async () => {
    const user = userEvent.setup();
    Object.assign(membersRead, read(CHAPTER));
    Object.assign(
      searchRead,
      read([ALUMNUS, { ...MEMBERS[0], is_alumni: false }]),
    );
    render(<MembersDirectory />);

    await user.type(screen.getByRole("searchbox"), "a");

    expect(await screen.findByText(/2 members matching/)).toBeInTheDocument();
    expect(screen.getByText("Charles Whitmore III")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Actives and alumni" }),
    ).toBeInTheDocument();
  });

  it("offers the Alumni role to assign, not to filter a list it can't match", async () => {
    const user = userEvent.setup();
    Object.assign(membersRead, read(CHAPTER));
    Object.assign(
      rolesRead,
      read([
        { id: "r-1", name: "Treasurer", is_system: false, permissions: [] },
        {
          id: "r-alumni",
          name: "Alumni",
          system_key: "ALUMNI",
          is_system: true,
          permissions: [],
        },
      ]),
    );
    render(<MembersDirectory />);

    const filter = screen.getByLabelText("Filter members by role");
    expect(
      within(filter).queryByRole("option", { name: "Role: Alumni" }),
    ).toBeNull();
    expect(
      within(filter).getByRole("option", { name: "Role: Treasurer" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", {
        name: /select all members on this page/i,
      }),
    );
    expect(
      within(screen.getByLabelText("Select role to assign")).getByRole(
        "option",
        { name: "Alumni" },
      ),
    ).toBeInTheDocument();
  });

  it("narrows the selection to the failures after a partly failed bulk assign", async () => {
    const user = userEvent.setup();
    Object.assign(membersRead, read(CHAPTER));
    mutateRoles.mockReset();
    mutateRoles.mockImplementation(({ id }: { id: string }) =>
      id === "m-2" ? Promise.reject(new Error("nope")) : Promise.resolve({}),
    );
    const { rerender } = render(<MembersDirectory />);

    await user.click(
      screen.getByRole("checkbox", {
        name: /select all members on this page/i,
      }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Select role to assign"),
      "r-1",
    );
    await user.click(screen.getByRole("button", { name: "Apply" }));

    // Only Grace's assignment failed, so only Grace is left to retry.
    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    // Had the role been Alumni, Ada's refetch would move her off this tab;
    // she must not linger in the count once she is gone.
    Object.assign(
      membersRead,
      read([{ ...MEMBERS[0], is_alumni: true }, CHAPTER[1], ALUMNUS]),
    );
    rerender(<MembersDirectory />);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("drops a selected member from the count once a refetch moves them to Alumni", async () => {
    const user = userEvent.setup();
    Object.assign(membersRead, read(CHAPTER));
    const { rerender } = render(<MembersDirectory />);

    await user.click(
      screen.getByRole("checkbox", {
        name: /select all members on this page/i,
      }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    // Ada is given Alumni some other way than the bulk bar (her own sheet,
    // another officer): the refetch takes her row away.
    Object.assign(
      membersRead,
      read([{ ...MEMBERS[0], is_alumni: true }, CHAPTER[1], ALUMNUS]),
    );
    rerender(<MembersDirectory />);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("offers the Alumni role and alumni class years to filter a search, which lists alumni", async () => {
    const user = userEvent.setup();
    Object.assign(membersRead, read(CHAPTER));
    Object.assign(
      searchRead,
      read([ALUMNUS, { ...MEMBERS[0], is_alumni: false }]),
    );
    Object.assign(
      rolesRead,
      read([
        { id: "r-1", name: "Treasurer", is_system: false, permissions: [] },
        {
          id: "r-alumni",
          name: "Alumni",
          system_key: "ALUMNI",
          is_system: true,
          permissions: [],
        },
      ]),
    );
    render(<MembersDirectory />);

    await user.type(screen.getByRole("searchbox"), "a");
    await screen.findByText(/2 members matching/);

    await user.selectOptions(
      screen.getByLabelText("Filter members by role"),
      "r-alumni",
    );
    expect(screen.getByText(/1 member matching/)).toBeInTheDocument();
    expect(screen.getByText("Charles Whitmore III")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /2019/ })).toBeInTheDocument();

    // Clearing the search takes the Alumni option away; the filter falls back
    // to all rather than silently filtering on an option no longer shown.
    await user.clear(screen.getByRole("searchbox"));
    expect(
      (screen.getByLabelText("Filter members by role") as HTMLSelectElement)
        .value,
    ).toBe("all");
    expect(screen.getByText("2 members")).toBeInTheDocument();
  });

  it("keeps an open sheet on a member who has just been made an alumnus", async () => {
    const user = userEvent.setup();
    Object.assign(membersRead, read(CHAPTER));
    const { rerender } = render(<MembersDirectory />);

    await user.click(screen.getByRole("button", { name: /^Ada Lovelace,/ }));
    expect(screen.getByTestId("detail-sheet")).toHaveTextContent(
      "Ada Lovelace",
    );

    // The officer saved the Alumni role; the refetch flags Ada, so she leaves
    // this tab's list. Her sheet is still the thing on screen.
    Object.assign(
      membersRead,
      read([{ ...MEMBERS[0], is_alumni: true }, CHAPTER[1], ALUMNUS]),
    );
    rerender(<MembersDirectory />);

    expect(screen.queryByRole("button", { name: /^Ada Lovelace,/ })).toBeNull();
    expect(screen.getByTestId("detail-sheet")).toHaveTextContent(
      "Ada Lovelace",
    );
  });
});
