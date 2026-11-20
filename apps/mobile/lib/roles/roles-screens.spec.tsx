/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useLocalSearchParams, useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SELF_ASSIGNABLE_SECTION_CAPTION } from "@repo/validation";

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
  // What the screen hands the Add role sheet (#5736), so a test can finish it.
  pickableSheet: null as null | { onCreated: (roleId: string) => void },
  permissions: [] as string[],
  roles: [] as unknown[],
  rolesUpdatedAt: 0,
  tiers: [] as unknown[],
  members: [] as unknown[],
  groups: [] as unknown[],
  vocabulary: {} as Record<string, string>,
  updateRole: vi.fn<(input: unknown) => Promise<object>>(async () => ({})),
  updateTier: vi.fn<(input: unknown) => Promise<object>>(async () => ({})),
  accentPresent: vi.fn(),
  backgroundPresent: vi.fn(),
  // `null` is a server without AI; an object is one that has it.
  aiConsent: null as object | null,
  // The chapter's AI switches (#4789), read only where the server has AI.
  aiSettings: null as Record<string, unknown> | null,
  updateAi: vi.fn(),
  aiSaving: false,
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

vi.mock("@repo/hooks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@repo/hooks")>();
  return {
    ...real,
    // A server without AI unless a test says so: the AI switches stay off.
    // The real rule (#4504), fed whether this server has AI from `h`.
    useAiConsent: () => ({ data: h.aiConsent }),
    useIsPermissionHidden: () => (permission: string) =>
      real.isPermissionHidden(permission, h.aiConsent !== null),
    usePermissionList: () => h.permissions,
    useMyPermissions: () => ok({ permissions: h.permissions }),
    useRoles: () => ({ ...ok(h.roles), dataUpdatedAt: h.rolesUpdatedAt }),
    useRoleTiers: () => ok(h.tiers),
    useMembers: () => ok(h.members),
    useGroups: () => ok(h.groups),
    useViewerUserId: () => "me",
    useCurrentChapter: () =>
      ok({ enabled_modules: { geofences: true }, vocabulary: h.vocabulary }),
    useGeofences: () => ok([{ id: "z1" }, { id: "z2" }]),
    useChapterChatBackground: () =>
      ok({ background: "midnight", photo_url: null }),
    useUpdateRole: () => ({ mutateAsync: h.updateRole, isPending: false }),
    useUpdateRoleTier: () => ({ mutateAsync: h.updateTier, isPending: false }),
    useAiChapterSettings: (options?: { enabled?: boolean }) =>
      ok(options?.enabled === false ? undefined : h.aiSettings),
    useUpdateAiChapterSettings: () => ({
      mutate: h.updateAi,
      isPending: h.aiSaving,
      isError: false,
    }),
  };
});

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

vi.mock("@/components/roles/new-pickable-role-sheet", async () => {
  const React = await import("react");
  return {
    NewPickableRoleSheet: React.forwardRef(function NewPickableRoleSheet(
      props: { onCreated: (roleId: string) => void },
      ref: React.Ref<{ present: () => void }>,
    ) {
      h.pickableSheet = props;
      React.useImperativeHandle(ref, () => ({ present: vi.fn() }));
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
  self_assignable: false,
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
    {
      id: "t-off",
      name: "Officers",
      position: 1,
      permissions: ["events:create", "members:invite"],
    },
    {
      id: "t-bro",
      name: "Brothers",
      position: 2,
      permissions: ["members:view"],
    },
  ];
  h.roles = [
    role({
      id: "r-pres",
      name: "President",
      permissions: ["*"],
      is_system: true,
      system_key: "PRESIDENT",
    }),
    role({
      id: "r-tres",
      name: "Treasurer",
      tier_id: "t-off",
      permissions: ["events:create", "members:invite"],
    }),
    role({
      id: "r-bro",
      name: "Brother",
      tier_id: "t-bro",
      permissions: ["members:view"],
    }),
    role({ id: "r-rush", name: "Rush Chair", permissions: ["members:view"] }),
  ];
  h.members = [
    { user_id: "me", role_ids: ["r-tres"] },
    { user_id: "u2", role_ids: ["r-bro"] },
    { user_id: "u3", role_ids: ["r-bro"] },
  ];
  h.updateRole.mockClear().mockResolvedValue({});
  h.updateTier.mockClear().mockResolvedValue({});
  h.aiConsent = null;
  h.rolesUpdatedAt = 0;
  h.groups = [
    {
      id: "g-house",
      name: "In house",
      kind: "manual",
      color: null,
      member_ids: ["me", "u2"],
    },
    {
      id: "g-class",
      name: "Fall 2025",
      kind: "pledge_class",
      color: null,
      member_ids: ["me"],
    },
  ];
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
    expect(text).toContain(
      "Study zones\nManaged on the web dashboard.\n2 zones",
    );
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

  it("shows a roles manager only Roles and groups, which opens that screen", () => {
    h.permissions = ["roles:manage", "members:view"];
    const tree = render(<ChapterSettingsScreen />);
    expect(screenText(tree)).not.toContain("Chapter accent");
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => pressable(tree, "Roles and groups").props.onPress());
    expect(push).toHaveBeenCalledWith("/chapter-roles");
  });
});

describe("Chapter settings → AI (#4789)", () => {
  const aiSwitch = (tree: ReturnType<typeof render>, label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onValueChange === "function",
    );
  const settings = (over: Record<string, unknown> = {}) => ({
    ask: true,
    meeting_notes: false,
    chat_source: false,
    can_change: true,
    updated_at: null,
    ...over,
  });
  afterEach(() => {
    h.aiConsent = null;
    h.aiSettings = null;
    h.aiSaving = false;
  });

  it("isn't drawn where the server has no AI", () => {
    h.aiSettings = settings();
    expect(screenText(render(<ChapterSettingsScreen />))).not.toContain(
      "Ask Frapp",
    );
  });

  it("lets the president turn a switch on, and names no AI company", () => {
    h.aiConsent = { answer: "yes" };
    h.aiSettings = settings();
    h.updateAi.mockClear();
    const tree = render(<ChapterSettingsScreen />);
    expect(aiSwitch(tree, "Ask Frapp").props.value).toBe(true);
    act(() => aiSwitch(tree, "Minutes from notes").props.onValueChange(true));
    expect(h.updateAi).toHaveBeenCalledWith(
      { meeting_notes: true },
      expect.anything(),
    );
    expect(screenText(tree)).not.toMatch(/Anthropic|Google|AssemblyAI/);
  });

  it("holds Include channel messages off until Ask is on, but lets it go off", () => {
    h.aiConsent = { answer: "yes" };
    h.aiSettings = settings({ ask: false });
    const off = render(<ChapterSettingsScreen />);
    expect(aiSwitch(off, "Include channel messages").props.disabled).toBe(true);
    expect(screenText(off)).toContain("Turn on Ask Frapp first.");

    h.aiSettings = settings({ ask: false, chat_source: true });
    const on = render(<ChapterSettingsScreen />);
    expect(aiSwitch(on, "Include channel messages").props.disabled).toBe(false);
  });

  it("draws Include channel messages nested under Ask, muted while Ask is off", () => {
    h.aiConsent = { answer: "yes" };
    h.aiSettings = settings({ ask: false });
    const tree = render(<ChapterSettingsScreen />);
    const row = tree.root.find(
      (node) =>
        node.props.label === "Include channel messages" &&
        node.props.trailing !== undefined,
    );
    expect(row.props.nested).toBe(true);
    expect(row.props.muted).toBe(true);
  });

  it("holds every switch while one saves", () => {
    h.aiConsent = { answer: "yes" };
    h.aiSettings = settings();
    h.aiSaving = true;
    const tree = render(<ChapterSettingsScreen />);
    expect(aiSwitch(tree, "Ask Frapp").props.disabled).toBe(true);
    expect(aiSwitch(tree, "Minutes from notes").props.disabled).toBe(true);
  });

  it("says on the switch's own row when its save failed", () => {
    h.aiConsent = { answer: "yes" };
    h.aiSettings = settings();
    h.updateAi.mockReset();
    h.updateAi.mockImplementation(
      (_body: unknown, options?: { onError?: () => void }) =>
        options?.onError?.(),
    );
    const tree = render(<ChapterSettingsScreen />);
    act(() => aiSwitch(tree, "Minutes from notes").props.onValueChange(true));
    const row = tree.root.find(
      (node) =>
        node.props.label === "Minutes from notes" &&
        node.props.trailing !== undefined,
    );
    expect(row.props.description).toBe(
      "Couldn't change the AI setting. Try again.",
    );
    expect(row.props.descriptionTone).toBe("destructive");
    h.updateAi.mockReset();
  });

  it("leaves the switches to chapter-config:view, as web's AI tab", () => {
    h.aiConsent = { answer: "yes" };
    h.aiSettings = settings();
    h.permissions = ["roles:manage", "members:view"];
    const text = screenText(render(<ChapterSettingsScreen />));
    expect(text).toContain("Roles");
    expect(text).not.toContain("Ask Frapp");
  });

  it("shows an officer the switches read-only, saying only the president changes them", () => {
    h.aiConsent = { answer: "yes" };
    h.aiSettings = settings({ can_change: false });
    const tree = render(<ChapterSettingsScreen />);
    expect(aiSwitch(tree, "Ask Frapp").props.disabled).toBe(true);
    expect(screenText(tree)).toContain(
      "Only the chapter president can turn these on or off.",
    );
  });
});

describe("Roles (#4074)", () => {
  it("lists the chapter's groups after the roles, own first, with counts", () => {
    const tree = render(<ChapterRolesScreen />);
    const text = screenText(tree);
    expect(text).toContain("Groups");
    expect(text.indexOf("In house")).toBeGreaterThan(
      text.indexOf("Rush Chair"),
    );
    expect(text.indexOf("Fall 2025")).toBeGreaterThan(text.indexOf("In house"));
    expect(text).toContain("Follows pledge class");
  });

  it("shows a groups manager without roles:manage only the groups", () => {
    h.permissions = ["groups:manage", "members:view"];
    const tree = render(<ChapterRolesScreen />);
    const text = screenText(tree);
    expect(text).toContain("In house");
    expect(text).not.toContain("Treasurer");
  });

  it("lists the tiers in rank order with their roles, then the roles outside", () => {
    const text = screenText(render(<ChapterRolesScreen />));
    expect(text).toContain("4 roles in 2 tiers");
    const order = [
      "Officers",
      "Treasurer",
      "Brothers",
      "Brother",
      "Outside the tiers",
      "President",
      "Rush Chair",
    ];
    let last = -1;
    for (const word of order) {
      const at = text.indexOf(word, last + 1);
      expect(at, word).toBeGreaterThan(last);
      last = at;
    }
  });

  it("notes the President's and Everyone's roles as web's list does", () => {
    h.roles = [
      ...h.roles,
      role({
        id: "r-all",
        name: "Everyone",
        tier_id: "t-bro",
        permissions: ["members:view"],
        is_system: true,
        system_key: "MEMBER",
      }),
    ];
    const text = screenText(render(<ChapterRolesScreen />));
    expect(text).toContain("Can do everything");
    expect(text).toContain("Pinged as @everyone");
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

  it("finds a role or group by name once the list is long", () => {
    h.roles = [
      ...h.roles,
      ...Array.from({ length: 10 }, (_, index) =>
        role({
          id: `r-x${index}`,
          name: `Committee ${index}`,
          tier_id: "t-bro",
        }),
      ),
    ];
    const tree = render(<ChapterRolesScreen />);
    const search = tree.root.find(
      (node) =>
        (node.type as unknown) === "TextInput" &&
        node.props.accessibilityLabel === "Find a role or group",
    );
    act(() => search.props.onChangeText("rush"));
    const text = screenText(tree);
    expect(text).toContain("Rush Chair");
    expect(text).not.toContain("Committee 3");
    expect(text).not.toContain("Treasurer");
    expect(text).not.toContain("In house");
    act(() => search.props.onChangeText("house"));
    expect(screenText(tree)).toContain("In house");
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

describe("Non-chapter business on the phone (#4958)", () => {
  const pickSwitch = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Switch" &&
        String(node.props.accessibilityLabel).startsWith(
          "Non-chapter business for",
        ),
    );

  it("marks a safe role at once", async () => {
    h.roles = [...h.roles, role({ id: "r-ims", name: "Intramurals" })];
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-ims" });
    const tree = render(<RoleScreen />);
    const [toggle] = pickSwitch(tree);
    expect(toggle!.props.disabled).toBe(false);
    await act(async () => {
      toggle!.props.onValueChange(true);
    });
    expect(h.updateRole).toHaveBeenCalledWith({
      id: "r-ims",
      body: { self_assignable: true },
    });
    expect(pickSwitch(tree)[0]!.props.value).toBe(true);
  });

  it("says why a role in a tier or with permissions can't be, and offers only off", () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-bro" });
    let tree = render(<RoleScreen />);
    // The phone can't move a role between tiers, so it says where to.
    expect(screenText(tree)).toContain(
      "Move it out of its tier on the web dashboard first.",
    );
    expect(pickSwitch(tree)[0]!.props.disabled).toBe(true);

    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-rush" });
    tree = render(<RoleScreen />);
    expect(screenText(tree)).toContain(
      "Roles members pick themselves can't carry permissions",
    );
    expect(pickSwitch(tree)[0]!.props.disabled).toBe(true);
  });

  it("lets a marked role that became unsafe be turned off", () => {
    h.roles = [
      ...h.roles,
      role({
        id: "r-ims",
        name: "Intramurals",
        tier_id: "t-bro",
        self_assignable: true,
      }),
    ];
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-ims" });
    const [toggle] = pickSwitch(render(<RoleScreen />));
    expect(toggle!.props.value).toBe(true);
    expect(toggle!.props.disabled).toBe(false);
  });

  it("shows what the roles read says once it lands after a save", async () => {
    h.roles = [...h.roles, role({ id: "r-ims", name: "Intramurals" })];
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-ims" });
    const tree = render(<RoleScreen />);
    await act(async () => {
      pickSwitch(tree)[0]!.props.onValueChange(true);
    });
    expect(pickSwitch(tree)[0]!.props.value).toBe(true);
    // Another officer turned it back off before this read landed.
    h.rolesUpdatedAt = Date.now() + 1000;
    act(() => {
      tree.update(
        <FrappThemeProvider>
          <RoleScreen />
        </FrappThemeProvider>,
      );
    });
    expect(pickSwitch(tree)[0]!.props.value).toBe(false);
  });

  it("has no switch on a built-in role", () => {
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-pres" });
    expect(pickSwitch(render(<RoleScreen />))).toHaveLength(0);
  });

  it("puts a failed save on its row and the switch back", async () => {
    h.roles = [...h.roles, role({ id: "r-ims", name: "Intramurals" })];
    h.updateRole.mockRejectedValueOnce(new Error("boom"));
    vi.mocked(useLocalSearchParams).mockReturnValue({ roleId: "r-ims" });
    const tree = render(<RoleScreen />);
    await act(async () => {
      pickSwitch(tree)[0]!.props.onValueChange(true);
    });
    expect(screenText(tree)).toContain(
      "Couldn't update Intramurals. Non-chapter business was not changed.",
    );
    expect(pickSwitch(tree)[0]!.props.value).toBe(false);
  });

  it("lists marked roles apart on the Roles screen", () => {
    h.roles = [
      ...h.roles,
      role({ id: "r-ims", name: "Intramurals", self_assignable: true }),
    ];
    const text = screenText(render(<ChapterRolesScreen />));
    const outside = text.indexOf("Outside the tiers");
    const business = text.indexOf("Non-chapter business");
    expect(business).toBeGreaterThan(outside);
    expect(text.indexOf("Rush Chair")).toBeLessThan(business);
    expect(text.indexOf("Intramurals")).toBeGreaterThan(business);
  });

  it("shows no empty Non-chapter business to a member who can't fill it", () => {
    h.permissions = ["members:view"];
    expect(screenText(render(<ChapterRolesScreen />))).not.toContain(
      "Non-chapter business",
    );
  });

  it("offers a roles manager Add role in Non-chapter business (#5736)", () => {
    const text = screenText(render(<ChapterRolesScreen />));
    const business = text.indexOf("Non-chapter business");
    expect(text).toContain(SELF_ASSIGNABLE_SECTION_CAPTION);
    expect(text).not.toContain("Turn it on from");
    expect(text.indexOf("Add role", business)).toBeGreaterThan(business);
  });

  it("keeps Add role once Non-chapter business has roles", () => {
    h.roles = [
      ...h.roles,
      role({ id: "r-ims", name: "Intramurals", self_assignable: true }),
    ];
    const text = screenText(render(<ChapterRolesScreen />));
    expect(text.indexOf("Add role")).toBeGreaterThan(
      text.indexOf("Intramurals"),
    );
  });

  it("opens the new role's page once the sheet creates it", () => {
    render(<ChapterRolesScreen />);
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => h.pickableSheet!.onCreated("r-new"));
    expect(push).toHaveBeenCalledWith({
      pathname: "/role",
      params: { roleId: "r-new" },
    });
  });

  it("offers no Add role to a roles manager who sits outside the tiers", () => {
    h.permissions = ["roles:manage", "members:view"];
    h.members = [{ user_id: "me", role_ids: ["r-rush"] }];
    const text = screenText(render(<ChapterRolesScreen />));
    expect(text).toContain("Non-chapter business");
    expect(text).not.toContain("Add role");
  });
});

/**
 * The switches for features this server doesn't offer stay off both screens
 * (#4504). Both screens draw through `useIsPermissionHidden`; the rule itself
 * (AI until the server has AI, Meetings while held off for the beta) is
 * pinned once, in `@repo/hooks`' own spec.
 */
describe("Switches for features not offered here (#4504)", () => {
  const AI_LABELS = ["Use AI", "Let AI take actions"];

  for (const [screen, params, Screen] of [
    ["tier", { tierId: "t-bro" }, RoleTierScreen],
    ["role", { roleId: "r-bro" }, RoleScreen],
  ] as const) {
    it(`leaves the AI switches off the ${screen} screen while the server has AI off`, () => {
      vi.mocked(useLocalSearchParams).mockReturnValue(params);
      const text = screenText(render(<Screen />));
      // A switch this screen always draws, so an empty screen can't pass.
      expect(text).toContain("Create events");
      for (const label of AI_LABELS) expect(text).not.toContain(label);
    });

    it(`offers the AI switches on the ${screen} screen once the server has AI`, () => {
      h.aiConsent = {};
      vi.mocked(useLocalSearchParams).mockReturnValue(params);
      const text = screenText(render(<Screen />));
      for (const label of AI_LABELS) expect(text).toContain(label);
    });
  }
});
