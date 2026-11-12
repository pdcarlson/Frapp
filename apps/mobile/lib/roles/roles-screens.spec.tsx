/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useLocalSearchParams, useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Chapter settings and its Roles screens on the phone (#4074), rendered. They
 * render `app/(app)/{chapter-settings,chapter-roles,role-tier,role}.tsx` but
 * live here: a spec under `app/` ships as a route module (`lib/routes.spec.ts`).
 *
 * The chapter: President (`*`), Officers (tier 1: Treasurer), Brothers (tier
 * 2: Brother), and Rush Chair outside the tiers. "me" holds Treasurer, so the
 * rank rules let them change Brothers and Brother but not Officers.
 */
const h = vi.hoisted(() => ({
  permissions: [] as string[],
  roles: [] as unknown[],
  tiers: [] as unknown[],
  members: [] as unknown[],
  vocabulary: {} as Record<string, string>,
  updateRole: vi.fn<(input: unknown) => Promise<object>>(async () => ({})),
  updateTier: vi.fn<(input: unknown) => Promise<object>>(async () => ({})),
  accentPresent: vi.fn(),
  backgroundPresent: vi.fn(),
}));

vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return reactNativeStub;
});

const ok = (data: unknown) => ({
  data,
  isPending: false,
  isSuccess: true,
  isError: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
});

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // A server without AI: the AI switches stay off the lists.
  useAiConsent: () => ({ data: null }),
  usePermissionList: () => h.permissions,
  useMyPermissions: () => ok({ permissions: h.permissions }),
  useRoles: () => ok(h.roles),
  useRoleTiers: () => ok(h.tiers),
  useMembers: () => ok(h.members),
  useViewerUserId: () => "me",
  useCurrentChapter: () =>
    ok({ enabled_modules: { geofences: true }, vocabulary: h.vocabulary }),
  useGeofences: () => ok([{ id: "z1" }, { id: "z2" }]),
  useChapterChatBackground: () =>
    ok({ background: "midnight", photo_url: null }),
  useUpdateRole: () => ({ mutateAsync: h.updateRole, isPending: false }),
  useUpdateRoleTier: () => ({ mutateAsync: h.updateTier, isPending: false }),
}));

vi.mock("@/components/settings/accent-sheet", async () => {
  const React = await import("react");
  return {
    AccentSheet: React.forwardRef(function AccentSheet(
      _props: object,
      ref: React.Ref<{ present: () => void }>,
    ) {
      React.useImperativeHandle(ref, () => ({ present: h.accentPresent }));
      return null;
    }),
  };
});
vi.mock("@/components/settings/chat-background-sheet", async () => {
  const React = await import("react");
  return {
    ChatBackgroundSheet: React.forwardRef(function ChatBackgroundSheet(
      _props: object,
      ref: React.Ref<{ present: () => void }>,
    ) {
      React.useImperativeHandle(ref, () => ({ present: h.backgroundPresent }));
      return null;
    }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    logoUrl: null,
    chapterName: null,
  }),
}));

import ChapterSettingsScreen from "@/app/(app)/chapter-settings";
import ChapterRolesScreen from "@/app/(app)/chapter-roles";
import RoleTierScreen from "@/app/(app)/role-tier";
import RoleScreen from "@/app/(app)/role";
import { OverrideSheet } from "@/components/roles/override-sheet";

const role = (over: Record<string, unknown>) => ({
  color: null,
  permissions: [],
  is_system: false,
  system_key: null,
  display_order: 0,
  mentionable: true,
  tier_id: null,
  permission_overrides: {},
  ...over,
});

const mounted: ReactTestRenderer[] = [];
function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  mounted.push(tree);
  return tree;
}

const switchFor = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Switch" &&
      String(node.props.accessibilityLabel).startsWith(`${label} for`),
  );

const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );

beforeEach(() => {
  h.permissions = ["*"];
  h.vocabulary = {};
  h.tiers = [
    { id: "t-off", name: "Officers", position: 1, permissions: ["events:create", "members:invite"] },
    { id: "t-bro", name: "Brothers", position: 2, permissions: ["members:view"] },
  ];
  h.roles = [
    role({ id: "r-pres", name: "President", permissions: ["*"], is_system: true, system_key: "PRESIDENT" }),
    role({ id: "r-tres", name: "Treasurer", tier_id: "t-off", permissions: ["events:create", "members:invite"] }),
    role({ id: "r-bro", name: "Brother", tier_id: "t-bro", permissions: ["members:view"] }),
    role({ id: "r-rush", name: "Rush Chair", permissions: ["members:view"] }),
  ];
  h.members = [
    { user_id: "me", role_ids: ["r-tres"] },
    { user_id: "u2", role_ids: ["r-bro"] },
    { user_id: "u3", role_ids: ["r-bro"] },
  ];
  h.updateRole.mockClear().mockResolvedValue({});
  h.updateTier.mockClear().mockResolvedValue({});
  vi.mocked(useLocalSearchParams).mockReturnValue({});
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("Chapter settings (#4074)", () => {
  it("holds the accent, chat background, study zones and Roles for an officer", () => {
    const text = screenText(render(<ChapterSettingsScreen />));
    expect(text).toContain("Chapter accent");
    expect(text).toContain("Chat background");
    expect(text).toContain("Midnight");
    expect(text).toContain("Study zones\nManaged on the web dashboard.\n2 zones");
    expect(text).toContain("Roles");
    expect(text).not.toContain("Set by an officer");
  });

  it("opens the accent and background sheets for an editor", () => {
    h.accentPresent.mockClear();
    h.backgroundPresent.mockClear();
    const tree = render(<ChapterSettingsScreen />);
    act(() => pressable(tree, "Chapter accent").props.onPress());
    act(() => pressable(tree, "Chat background").props.onPress());
    expect(h.accentPresent).toHaveBeenCalled();
    expect(h.backgroundPresent).toHaveBeenCalled();
  });

  it("tells a member who can't edit the chapter who can, with no way into the sheets", () => {
    h.permissions = ["chapter-config:view"];
    const tree = render(<ChapterSettingsScreen />);
    expect(screenText(tree)).toContain(
      "Set by an officer with chapter settings access.",
    );
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          (node.props.accessibilityLabel === "Chapter accent" ||
            node.props.accessibilityLabel === "Chat background"),
      ),
    ).toHaveLength(0);
  });

  it("shows a roles manager only Roles, which opens the Roles screen", () => {
    h.permissions = ["roles:manage", "members:view"];
    const tree = render(<ChapterSettingsScreen />);
    expect(screenText(tree)).not.toContain("Chapter accent");
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => pressable(tree, "Roles").props.onPress());
    expect(push).toHaveBeenCalledWith("/chapter-roles");
  });
});

describe("Roles (#4074)", () => {
  it("lists the tiers in rank order with their roles, then the roles outside", () => {
    const text = screenText(render(<ChapterRolesScreen />));
    expect(text).toContain("4 roles in 2 tiers");
    const order = ["Officers", "Treasurer", "Brothers", "Brother", "Outside the tiers", "President", "Rush Chair"];
    let last = -1;
    for (const word of order) {
      const at = text.indexOf(word, last + 1);
      expect(at, word).toBeGreaterThan(last);
      last = at;
    }
  });

  it("names tiers in the chapter's own word", () => {
    h.vocabulary = { tier: "Level" };
    const text = screenText(render(<ChapterRolesScreen />));
    expect(text).toContain("4 roles in 2 levels");
    expect(text).toContain("Outside the levels");
  });

  it("opens a tier's permissions and a role's page", () => {
    const tree = render(<ChapterRolesScreen />);
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    const permissionsRow = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityHint ===
          "Opens what every role in Brothers can do.",
    );
    act(() => permissionsRow.props.onPress());
    expect(push).toHaveBeenCalledWith({
      pathname: "/role-tier",
      params: { tierId: "t-bro" },
    });
    act(() => pressable(tree, "Rush Chair").props.onPress());
    expect(push).toHaveBeenCalledWith({
      pathname: "/role",
      params: { roleId: "r-rush" },
    });
  });

  it("finds a role by name once the list is long", () => {
    h.roles = [
      ...h.roles,
      ...Array.from({ length: 10 }, (_, index) =>
        role({ id: `r-x${index}`, name: `Committee ${index}`, tier_id: "t-bro" }),
      ),
    ];
    const tree = render(<ChapterRolesScreen />);
    const search = tree.root.find(
      (node) =>
        (node.type as unknown) === "TextInput" &&
        node.props.accessibilityLabel === "Find a role",
    );
    act(() => search.props.onChangeText("rush"));
    const text = screenText(tree);
    expect(text).toContain("Rush Chair");
    expect(text).not.toContain("Committee 3");
    expect(text).not.toContain("Treasurer");
  });
});

describe("A tier's permissions (#4074)", () => {
  it("saves a switch as the tier's whole list", async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ tierId: "t-bro" });
    const tree = render(<RoleTierScreen />);
    expect(screenText(tree)).toContain("Brothers");
    await act(async () => {
      switchFor(tree, "Create events").props.onValueChange(true);
    });
    expect(h.updateTier).toHaveBeenCalledWith({
      id: "t-bro",
      body: { permissions: ["members:view", "events:create"] },
    });
  });

  it("locks a tier at or above the officer's own, and says why once", () => {
    h.permissions = ["events:create", "members:invite", "roles:manage"];
    vi.mocked(useLocalSearchParams).mockReturnValue({ tierId: "t-off" });
    const tree = render(<RoleTierScreen />);
    expect(screenText(tree)).toContain(
      "This tier ranks at or above yours, so your role can't change it.",
    );
    expect(switchFor(tree, "Invite members").props.disabled).toBe(true);
  });

  it("won't let an officer give what their role lacks, and says so on the row", () => {
    h.permissions = ["events:create", "members:invite", "roles:manage"];
    vi.mocked(useLocalSearchParams).mockReturnValue({ tierId: "t-bro" });
    const tree = render(<RoleTierScreen />);
    expect(switchFor(tree, "Create events").props.disabled).toBe(false);
    expect(switchFor(tree, "Remove members").props.disabled).toBe(true);
    expect(screenText(tree)).toContain(
      "You can't give this, because your role doesn't have it.",
    );
  });

  it("puts a failed save on its row, and the switch back", async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ tierId: "t-bro" });
    h.updateTier.mockRejectedValueOnce(new Error("boom"));
    const tree = render(<RoleTierScreen />);
    await act(async () => {
      switchFor(tree, "Create events").props.onValueChange(true);
    });
    expect(screenText(tree)).toContain("Couldn't update Brothers.");
    expect(switchFor(tree, "Create events").props.value).toBe(false);
  });
});

describe("A role's permissions (#4074)", () => {
  it("shows each answer and where it comes from, and saves one override key", async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-bro" });
    const tree = render(<RoleScreen />);
    const text = screenText(tree);
    expect(text).toContain("Starts from Brothers.");
    // Following the tier is the quiet default: no line under the row.
    expect(text).not.toContain("Same as Brothers");

    act(() => pressable(tree, "Create events").props.onPress());
    const sheet = tree.root.findByType(OverrideSheet);
    expect(sheet.props.target).toMatchObject({
      permission: "events:create",
      tierHas: false,
      current: null,
    });
    await act(async () => {
      sheet.props.onPick("events:create", true);
    });
    expect(screenText(tree)).toContain(
      "Create events\nSet for this role. Brothers has it off.",
    );
    expect(h.updateRole).toHaveBeenCalledWith({
      id: "r-bro",
      body: { permission_overrides: { "events:create": true } },
    });
  });

  it("gives a role outside the tiers plain switches", async () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-rush" });
    const tree = render(<RoleScreen />);
    expect(screenText(tree)).toContain(
      "Outside the tiers, so its permissions are its own.",
    );
    await act(async () => {
      switchFor(tree, "Create events").props.onValueChange(true);
    });
    expect(h.updateRole).toHaveBeenCalledWith({
      id: "r-rush",
      body: { permissions: ["members:view", "events:create"] },
    });
  });

  it("keeps the President's role still", () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-pres" });
    const tree = render(<RoleScreen />);
    expect(screenText(tree)).toContain(
      "This role can do everything. That only moves through Transfer presidency.",
    );
    expect(switchFor(tree, "Invite members").props.disabled).toBe(true);
    expect(switchFor(tree, "Invite members").props.value).toBe(true);
  });
});
