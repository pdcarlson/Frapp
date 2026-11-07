/** @vitest-environment jsdom */
import { backArrowColor } from "@/test/back-row";
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Share } from "react-native";
import { ReduceMotion } from "react-native-reanimated";
import type { ChapterDirectoryResult } from "@repo/hooks";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { flatStyle } from "@/test/flat-style";

/**
 * Chapter setup (#3351): find, confirm, color, then the live moment, the push
 * primer when this build can push, the invite, and chat. These pin the step
 * order, the archetype rule (a match carries it, by hand it is asked with
 * nothing preselected), the letters rule (an organization that hides its
 * letters shows them nowhere), the optional logo, and the primer the founder
 * now gets here instead of on s03.
 *
 * It renders `app/(auth)/create-chapter.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

let pushAvailable = false;
const requestPushPermission = vi.fn();
let permission: {
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
} | null = null;

vi.mock("@/lib/notifications/push", () => ({
  isPushAvailable: () => pushAvailable,
  getPushPermission: () =>
    Promise.resolve(
      permission && {
        canAskAgain: true,
        status: permission.granted ? "granted" : "undetermined",
        ...permission,
      },
    ),
  isPushChannelBlocked: () => Promise.resolve(false),
  requestPushPermission: (...args: unknown[]) => requestPushPermission(...args),
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: "authenticated", chapterId: null }),
}));

const selectChapter = vi.fn();
vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => selectChapter,
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

const pickAndSetChapterLogo = vi.fn();
vi.mock("@/lib/onboarding/chapter-wizard/chapter-logo", () => ({
  pickAndSetChapterLogo: (mutations: unknown) =>
    pickAndSetChapterLogo(mutations),
}));

let directoryRows: ChapterDirectoryResult[] = [];
const onboard = vi.fn();
const createInvite = vi.fn();
let inviteList: { token: string; used_at: string | null }[] = [];
let invitesOptions: { enabled?: boolean; refetchInterval?: number } | undefined;
let currentChapter: { logo_url: string | null } | undefined;

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChapterDirectorySearch: () => ({
    data: directoryRows,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useOnboardChapter: () => ({ isPending: false, mutateAsync: onboard }),
  useCreateInvite: () => ({ isPending: false, mutateAsync: createInvite }),
  useInvites: (options?: { enabled?: boolean; refetchInterval?: number }) => {
    invitesOptions = options;
    return { data: options?.enabled ? inviteList : undefined };
  },
  useCurrentChapter: () => ({ data: currentChapter }),
  useRequestChapterLogoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmChapterLogo: () => ({ mutateAsync: vi.fn() }),
  useChannels: () => ({
    isPending: false,
    isError: false,
    data: [
      { id: "c1", name: "general", is_member: true, type: "PUBLIC" },
      { id: "c2", name: "announcements", is_member: true, type: "PUBLIC" },
    ],
  }),
}));

vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));

// The founder's new chapter is purple, so a setup control that follows the
// chapter accent instead of house gold shows up as purple.
vi.mock("@/lib/chapter-branding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/chapter-branding")>();
  return {
    ...actual,
    useChapterBranding: () => ({
      ...actual.useChapterBranding(),
      accent: "#CB9FFF",
    }),
  };
});

import CreateChapter, { SETUP_TITLES } from "@/app/(auth)/create-chapter";
import { ShareGlyph } from "@/components/control-glyphs";
import {
  INVITE_WATCH_INTERVAL_MS,
  SHARE_FAILED_MESSAGE,
} from "@/lib/onboarding/chapter-wizard/use-invite-shares";

type Node = ReactTestRenderer["root"];

const FIJI_ROW: ChapterDirectoryResult = {
  id: "dir-fiji",
  org_letters: "ΦΓΔ",
  org_name: "Phi Gamma Delta",
  archetype: "ifc",
  chapter_designation: "Tau Nu",
  university: "Rensselaer Polytechnic Institute",
  university_short: "RPI",
  founded_year: 1893,
  default_colors: { accent: "#C9A227" },
  website: null,
};

/** A sorority row: its archetype isn't the first one, so a default can't pass. */
const ALPHA_PHI_ROW: ChapterDirectoryResult = {
  ...FIJI_ROW,
  id: "dir-aphi",
  org_letters: "ΑΦ",
  org_name: "Alpha Phi",
  archetype: "npc",
  chapter_designation: "Theta Eta",
};

const SIGEP_ROW: ChapterDirectoryResult = {
  ...FIJI_ROW,
  id: "dir-sigep",
  org_letters: "ΣΦΕ",
  org_name: "Sigma Phi Epsilon",
  chapter_designation: "New York Alpha",
};

/** An organization with no short name and letters it shows. */
const SIGMA_NU_ROW: ChapterDirectoryResult = {
  ...FIJI_ROW,
  id: "dir-sigma-nu",
  org_letters: "ΣΝ",
  org_name: "Sigma Nu",
  chapter_designation: "Delta Delta",
};

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function render(): Promise<ReactTestRenderer> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappThemeProvider>
          <CreateChapter />
        </FrappThemeProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return tree;
}

function allText(root: Node): string {
  return JSON.stringify(
    root
      .findAllByType("Text" as never, { deep: true })
      .map((t) => t.props.children ?? ""),
  );
}

function title(root: Node): string {
  const header = root
    .findAllByType("Text" as never, { deep: true })
    .find((t) => t.props.accessibilityRole === "header");
  return String(header?.props.children ?? "");
}

/** The pressable whose own rendered text, or label, is `label`. */
function control(root: Node, label: string) {
  return root
    .findAllByType("Pressable" as never, { deep: true })
    .find(
      (pressable) =>
        pressable.props.accessibilityLabel === label ||
        pressable
          .findAllByType("Text" as never, { deep: true })
          .some((text) =>
            JSON.stringify(text.props.children ?? "").includes(label),
          ),
    );
}

async function press(root: Node, label: string): Promise<void> {
  const target = control(root, label);
  if (!target) throw new Error(`No control "${label}"`);
  await act(async () => {
    target.props.onPress();
  });
  await settle();
}

/** The ChoiceRow for a directory row, by the title it renders. */
async function pickRow(root: Node, rowTitle: string): Promise<void> {
  await press(root, rowTitle);
}

function primary(root: Node) {
  const pressables = root.findAllByType("Pressable" as never, { deep: true });
  return pressables[pressables.length - 1];
}

function radios(root: Node) {
  return root
    .findAllByType("Pressable" as never, { deep: true })
    .filter((p) => p.props.accessibilityRole === "radio");
}

function inputValues(root: Node): string {
  return JSON.stringify(
    root
      .findAllByType("TextInput" as never, { deep: true })
      .map((i) => [i.props.accessibilityLabel, i.props.value]),
  );
}

function lettersSwitch(root: Node) {
  return root
    .findAllByType("Switch" as never, { deep: true })
    .find((s) => s.props.accessibilityLabel === "Show Greek letters");
}

function typeInto(root: Node, label: string, value: string): void {
  const input = root
    .findAllByType("TextInput" as never, { deep: true })
    .find((i) => i.props.accessibilityLabel === label);
  if (!input) throw new Error(`No field "${label}"`);
  act(() => {
    input.props.onChangeText(value);
  });
}

/** From a FIJI match to the live step. */
async function createFromMatch(root: Node): Promise<void> {
  await pickRow(root, "Phi Gamma Delta");
  await press(root, "Continue");
  await press(root, "agree");
  await act(async () => {
    primary(root).props.onPress();
  });
  await settle();
}

beforeEach(() => {
  pushAvailable = false;
  permission = null;
  directoryRows = [FIJI_ROW, SIGEP_ROW];
  currentChapter = { logo_url: null };
  selectChapter.mockReset().mockResolvedValue(true);
  onboard.mockReset().mockResolvedValue({ id: "chapter-new" });
  createInvite.mockReset().mockResolvedValue({ token: "tok123" });
  inviteList = [];
  vi.mocked(Share.share)
    .mockReset()
    .mockResolvedValue({ action: "sharedAction" });
  pickAndSetChapterLogo.mockReset();
  successHaptic.mockReset();
  requestPushPermission.mockReset().mockResolvedValue(true);
  vi.mocked(useRouter().replace).mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("chapter setup — step order", () => {
  it("goes find, confirm, color, live, invite, then chat", async () => {
    const { root } = await render();
    expect(title(root)).toBe(SETUP_TITLES.find);

    await pickRow(root, "Phi Gamma Delta");
    expect(title(root)).toBe(SETUP_TITLES.confirmMatch);

    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.color);
    // Create stays off until the Terms are accepted.
    expect(primary(root).props.disabled).toBe(true);
    await press(root, "agree");
    expect(primary(root).props.disabled).toBe(false);
    expect(allText(root)).toContain("Create FIJI");

    await act(async () => {
      primary(root).props.onPress();
    });
    await settle();
    expect(title(root)).toBe("FIJI is live");
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(selectChapter).toHaveBeenCalledWith("chapter-new");
    // The seeded channels, named.
    expect(allText(root)).toContain("general");
    // No way back to before the chapter existed.
    expect(control(root, "Back")).toBeUndefined();

    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.invite);

    await press(root, "Share invite");
    expect(JSON.stringify(vi.mocked(Share.share).mock.calls[0])).toContain(
      "tok123",
    );

    await press(root, "Go to chat");
    expect(useRouter().replace).toHaveBeenCalledWith("/(tabs)");
  });

  it("draws its ‹ Back row in house gold, not the chapter's accent", async () => {
    const { root } = await render();
    const backInk = () => backArrowColor(control(root, "Back")!);
    // `gold.askText` on find, confirm and color: `(auth)` has no chapter.
    expect(backInk()).toBe(signetDarkTokens.color.gold.askText);
    await pickRow(root, "Phi Gamma Delta");
    expect(backInk()).toBe(signetDarkTokens.color.gold.askText);
    await press(root, "Continue");
    expect(backInk()).toBe(signetDarkTokens.color.gold.askText);
  });

  it("steps back from color to confirm to find", async () => {
    const { root } = await render();
    await pickRow(root, "Phi Gamma Delta");
    await press(root, "Continue");
    await press(root, "Back");
    expect(title(root)).toBe(SETUP_TITLES.confirmMatch);
    await press(root, "Back");
    expect(title(root)).toBe(SETUP_TITLES.find);
  });

  it("keeps the officer on color with the server's words when create fails", async () => {
    onboard.mockRejectedValue({ message: "That chapter already exists." });
    const { root } = await render();
    await createFromMatch(root);
    expect(title(root)).toBe(SETUP_TITLES.color);
    expect(allText(root)).toContain("That chapter already exists.");
    expect(successHaptic).not.toHaveBeenCalled();
  });
});

describe("chapter setup — archetype", () => {
  it("takes it from the directory match and never asks", async () => {
    directoryRows = [ALPHA_PHI_ROW];
    const { root } = await render();
    await pickRow(root, "Alpha Phi");
    await press(root, "Continue");
    await press(root, "agree");
    await act(async () => {
      primary(root).props.onPress();
    });
    await settle();
    expect(onboard).toHaveBeenCalledWith(
      expect.objectContaining({
        org_archetype: "npc",
        directory_id: "dir-aphi",
      }),
    );
  });

  it("does not ask on a match", async () => {
    const { root } = await render();
    await pickRow(root, "Phi Gamma Delta");
    expect(radios(root)).toHaveLength(0);
    expect(primary(root).props.disabled).toBe(false);
  });

  it("asks by hand with nothing preselected, and holds Continue until one is picked", async () => {
    const { root } = await render();
    await press(root, "Not in our directory?");
    expect(title(root)).toBe(SETUP_TITLES.confirmManual);

    typeInto(root, "Organization", "Delta Upsilon");
    typeInto(root, "School", "Westfield State");
    const options = radios(root);
    expect(options.length).toBeGreaterThan(1);
    expect(
      options.every(
        (option) => option.props.accessibilityState.checked === false,
      ),
    ).toBe(true);
    expect(primary(root).props.disabled).toBe(true);

    await act(async () => {
      options[1].props.onPress();
    });
    expect(primary(root).props.disabled).toBe(false);
  });

  it("asks when the match carries an archetype this app doesn't know", async () => {
    directoryRows = [{ ...SIGEP_ROW, archetype: "unknown-kind" }];
    const { root } = await render();
    await pickRow(root, "Sigma Phi Epsilon");
    expect(radios(root).length).toBeGreaterThan(1);
    expect(primary(root).props.disabled).toBe(true);
  });
});

describe("chapter setup — Greek letters", () => {
  it("shows no FIJI letters in the results, the card, or the details", async () => {
    const { root } = await render();
    const find = allText(root);
    expect(find).not.toContain("ΦΓΔ");
    // Another organization's letters still show.
    expect(find).toContain("ΣΦΕ");

    await pickRow(root, "Phi Gamma Delta");
    expect(allText(root)).not.toContain("ΦΓΔ");
    expect(
      root
        .findByProps({ testID: "confirm-card" })
        .findAllByType("Text" as never).length,
    ).toBeGreaterThan(0);

    await press(root, "Edit details");
    // Neither the letters field nor a switch that could turn them back on.
    expect(lettersSwitch(root)).toBeUndefined();
    expect(allText(root)).toContain("doesn't display its Greek letters");
    const shortName = root
      .findAllByType("TextInput" as never, { deep: true })
      .find((i) => i.props.accessibilityLabel === "Short name");
    expect(shortName?.props.value).toBe("FIJI");
    // Nor in any field.
    expect(inputValues(root)).not.toContain("ΦΓΔ");
    expect(inputValues(root)).not.toContain("Greek letters");
    expect(allText(root)).not.toContain("ΦΓΔ");
  });

  it("keeps the letters field for an organization that shows them", async () => {
    const { root } = await render();
    await pickRow(root, "Sigma Phi Epsilon");
    await press(root, "Edit details");
    expect(inputValues(root)).toContain("ΣΦΕ");
    expect(lettersSwitch(root)?.props.value).toBe(true);
  });

  it("applies the same rule when FIJI is typed by hand", async () => {
    const { root } = await render();
    await press(root, "Not in our directory?");
    typeInto(root, "Organization", "Phi Gamma Delta");
    typeInto(root, "School", "Rensselaer Polytechnic Institute");
    await press(root, "More details (optional)");

    expect(lettersSwitch(root)).toBeUndefined();
    expect(inputValues(root)).toContain('["Short name","FIJI"]');
    expect(inputValues(root)).not.toContain("Greek letters");

    await act(async () => {
      radios(root)[0].props.onPress();
    });
    await press(root, "Continue");
    expect(allText(root)).toContain("Create FIJI");
  });

  it("applies it to a name carried over from the search", async () => {
    directoryRows = [];
    const { root } = await render();
    typeInto(root, "Search the chapter directory", "Phi Gamma Delta");
    await press(root, "Not in our directory?");
    expect(inputValues(root)).toContain('["Organization","Phi Gamma Delta"]');
    await press(root, "More details (optional)");
    expect(inputValues(root)).toContain('["Short name","FIJI"]');
    expect(lettersSwitch(root)).toBeUndefined();
  });

  // The match web's setup makes (`orgHidingGreekLettersIn`), not only the
  // directory's exact name. The letters are typed under another name first,
  // with the switch on, so the switch going off is the name's doing
  // (`orgMarkFieldsFor`), which also fills the empty short name.
  it.each(["FIJI", "Phi Gamma Delta (FIJI)", "phi gamma delta tau nu"])(
    "hides the letters for %s typed by hand, and sends them off",
    async (orgName) => {
      const { root } = await render();
      await press(root, "Not in our directory?");
      typeInto(root, "Organization", "Delta Tau");
      typeInto(root, "School", "Rensselaer Polytechnic Institute");
      await press(root, "More details (optional)");
      typeInto(root, "Greek letters", "ΦΓΔ");
      expect(lettersSwitch(root)?.props.value).toBe(true);

      typeInto(root, "Organization", orgName);
      expect(lettersSwitch(root)).toBeUndefined();
      expect(inputValues(root)).not.toContain("Greek letters");
      expect(allText(root)).toContain(
        `["Phi Gamma Delta"," doesn't display its Greek letters`,
      );
      expect(allText(root)).not.toContain("ΦΓΔ");
      expect(inputValues(root)).toContain('["Short name","FIJI"]');

      await act(async () => {
        radios(root)[0].props.onPress();
      });
      await press(root, "Continue");
      expect(allText(root)).not.toContain("ΦΓΔ");
      await press(root, "agree");
      await act(async () => {
        primary(root).props.onPress();
      });
      await settle();
      const body = onboard.mock.calls[0]?.[0] as {
        branding: { show_greek_letters?: boolean; short_name?: string };
      };
      expect(body.branding.show_greek_letters).toBe(false);
      expect(body.branding.short_name).toBe("FIJI");
      expect(allText(root)).not.toContain("ΦΓΔ");
    },
  );

  /** Submit from the confirm step of a match, and return what was sent. */
  async function submitMatch(root: Node): Promise<SentBranding> {
    await press(root, "Continue");
    expect(allText(root)).not.toContain("ΦΓΔ");
    await press(root, "agree");
    await act(async () => {
      primary(root).props.onPress();
    });
    await settle();
    expect(allText(root)).not.toContain("ΦΓΔ");
    return (onboard.mock.calls[0]?.[0] as { branding: SentBranding }).branding;
  }

  type SentBranding = { show_greek_letters?: boolean; short_name?: string };

  // FIJI's row is FIJI whatever its name field says later, as on web: typing
  // the chapter onto the name keeps the short name, and a name that no longer
  // names FIJI at all still hides the letters.
  it.each(["Phi Gamma Delta Tau Nu", "Phi Gamma Delt", "Tau Nu Chapter"])(
    "keeps FIJI's row hidden and its short name when the name becomes %s",
    async (orgName) => {
      const { root } = await render();
      await pickRow(root, "Phi Gamma Delta");
      await press(root, "Edit details");
      typeInto(root, "Organization", orgName);

      expect(inputValues(root)).toContain(`["Organization","${orgName}"]`);
      expect(inputValues(root)).toContain('["Short name","FIJI"]');
      expect(lettersSwitch(root)).toBeUndefined();
      expect(inputValues(root)).not.toContain("ΦΓΔ");
      expect(allText(root)).toContain(
        `["Phi Gamma Delta"," doesn't display its Greek letters`,
      );
      expect(allText(root)).not.toContain("ΦΓΔ");

      const sent = await submitMatch(root);
      expect(sent.show_greek_letters).toBe(false);
      expect(sent.short_name).toBe("FIJI");
    },
  );

  // Another organization's row renamed to FIJI changes the name alone, as on
  // web, so its switch is still on: the last-line guard keeps the letters
  // off what is drawn and sent.
  it("hides the letters when another row's name is changed to FIJI", async () => {
    const { root } = await render();
    await pickRow(root, "Sigma Phi Epsilon");
    await press(root, "Edit details");
    typeInto(root, "Greek letters", "ΦΓΔ");
    typeInto(root, "Organization", "FIJI");
    expect(lettersSwitch(root)).toBeUndefined();
    expect(inputValues(root)).not.toContain("ΦΓΔ");

    const sent = await submitMatch(root);
    expect(sent.show_greek_letters).toBe(false);
  });

  // A pick undoes what the row picked before it set, however that row's name
  // was edited in between: the edit changed the name alone, so the earlier
  // row's organization is the one being left (`directoryMatchMarkFields`).
  it("undoes FIJI's short name and switch when a renamed FIJI row gives way to another", async () => {
    directoryRows = [FIJI_ROW, SIGMA_NU_ROW];
    const { root } = await render();
    await pickRow(root, "Phi Gamma Delta");
    await press(root, "Edit details");
    typeInto(root, "Organization", "Tau Nu Chapter");
    expect(inputValues(root)).toContain('["Short name","FIJI"]');
    await press(root, "Back");
    expect(title(root)).toBe(SETUP_TITLES.find);

    await pickRow(root, "ΣΝ · Sigma Nu");
    await press(root, "Edit details");
    expect(inputValues(root)).toContain('["Short name",""]');
    expect(lettersSwitch(root)?.props.value).toBe(true);
    expect(allText(root)).not.toContain("doesn't display its Greek letters");

    const sent = await submitMatch(root);
    expect(sent.short_name).toBeUndefined();
    expect(sent.show_greek_letters).toBeUndefined();
  });

  it("fills FIJI's short name when FIJI's row follows another row renamed FIJI", async () => {
    const { root } = await render();
    await pickRow(root, "Sigma Phi Epsilon");
    await press(root, "Edit details");
    typeInto(root, "Organization", "FIJI");
    await press(root, "Back");

    await pickRow(root, "Phi Gamma Delta");
    await press(root, "Edit details");
    expect(inputValues(root)).toContain('["Short name","FIJI"]');
    expect(lettersSwitch(root)).toBeUndefined();

    const sent = await submitMatch(root);
    expect(sent.short_name).toBe("FIJI");
    expect(sent.show_greek_letters).toBe(false);
  });

  // Entering the chapter by hand forgets the row picked before: an unrelated
  // organization typed after FIJI's row is that organization's alone.
  it("forgets FIJI's row on manual entry", async () => {
    const { root } = await render();
    await pickRow(root, "Phi Gamma Delta");
    await press(root, "Back");
    await press(root, "Not in our directory?");
    typeInto(root, "Organization", "Sigma Nu");
    typeInto(root, "School", "Rensselaer Polytechnic Institute");
    await press(root, "More details (optional)");

    expect(lettersSwitch(root)?.props.value).toBe(true);
    expect(inputValues(root)).toContain('["Short name",""]');
    expect(allText(root)).not.toContain("doesn't display its Greek letters");

    await act(async () => {
      radios(root)[0].props.onPress();
    });
    await press(root, "Continue");
    await press(root, "agree");
    await act(async () => {
      primary(root).props.onPress();
    });
    await settle();
    const sent = (onboard.mock.calls[0]?.[0] as { branding: SentBranding })
      .branding;
    expect(sent.show_greek_letters).toBeUndefined();
    expect(sent.short_name).toBeUndefined();
  });

  it("fills the short name when FIJI is typed by hand, and leaves a typed one", async () => {
    const { root } = await render();
    await press(root, "Not in our directory?");
    await press(root, "More details (optional)");
    typeInto(root, "Organization", "FIJI");
    expect(inputValues(root)).toContain('["Short name","FIJI"]');

    // Leaving FIJI undoes its short name; a short name the founder typed
    // stays when the name comes back to FIJI.
    typeInto(root, "Organization", "Sigma Nu");
    expect(inputValues(root)).toContain('["Short name",""]');
    typeInto(root, "Short name", "TN");
    typeInto(root, "Organization", "FIJI");
    expect(inputValues(root)).toContain('["Short name","TN"]');
    expect(lettersSwitch(root)).toBeUndefined();
  });

  it("sends FIJI's branding with the letters switched off", async () => {
    const { root } = await render();
    await createFromMatch(root);
    const body = onboard.mock.calls[0]?.[0] as {
      branding: {
        show_greek_letters?: boolean;
        short_name?: string;
        greek_letters?: string;
      };
    };
    // Stored but hidden, as web's wizard stores them: the switch hides, it
    // doesn't delete (branding.md).
    expect(body.branding).toEqual(
      expect.objectContaining({
        show_greek_letters: false,
        short_name: "FIJI",
        greek_letters: "ΦΓΔ",
      }),
    );
    // The live mark is the short name, not the letters.
    expect(allText(root)).not.toContain("ΦΓΔ");
  });
});

describe("chapter setup — logo", () => {
  it("is optional: Continue skips it", async () => {
    const { root } = await render();
    await createFromMatch(root);
    expect(control(root, "Add your chapter's logo")).toBeDefined();
    await press(root, "Continue");
    expect(pickAndSetChapterLogo).not.toHaveBeenCalled();
    expect(title(root)).toBe(SETUP_TITLES.invite);
  });

  it("draws the logo once it is set", async () => {
    pickAndSetChapterLogo.mockImplementation(async () => {
      // The picker takes a moment, as on a device.
      await new Promise((resolve) => setTimeout(resolve, 0));
      currentChapter = { logo_url: "https://cdn.example/logo.png" };
      return { status: "updated" };
    });
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Add your chapter's logo");
    expect(pickAndSetChapterLogo).toHaveBeenCalledTimes(1);
    // The confirm refetches the chapter, which now answers with the logo.
    expect(control(root, "Change logo")).toBeDefined();
    const logo = root
      .findAllByType("Image" as never, { deep: true })
      .find((image) => image.props.accessibilityLabel === "Chapter logo");
    expect(logo?.props.source).toEqual({ uri: "https://cdn.example/logo.png" });
  });

  it("says why when the upload is refused, and stays on the live step", async () => {
    pickAndSetChapterLogo.mockResolvedValue({
      status: "refused",
      reason: "Logos can be up to 10 MB.",
    });
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Add your chapter's logo");
    expect(allText(root)).toContain("Logos can be up to 10 MB.");
    expect(title(root)).toBe("FIJI is live");
  });

  it("isn't offered when the new chapter couldn't be made active", async () => {
    selectChapter.mockResolvedValue(false);
    const { root } = await render();
    await createFromMatch(root);
    expect(control(root, "Add your chapter's logo")).toBeUndefined();
  });
});

describe("chapter setup — new chapter not active", () => {
  it("names no channels and skips the invite, which would mint for another chapter", async () => {
    selectChapter.mockResolvedValue(false);
    const { root } = await render();
    await createFromMatch(root);
    expect(title(root)).toBe("FIJI is live");
    expect(allText(root)).not.toContain("general");

    await press(root, "Continue");
    expect(control(root, "Share invite")).toBeUndefined();
    expect(useRouter().replace).toHaveBeenCalledWith("/(tabs)");
    expect(createInvite).not.toHaveBeenCalled();
  });
});

describe("chapter setup — push primer for the founder", () => {
  it("offers it after the live step when this build can push", async () => {
    pushAvailable = true;
    permission = { granted: false };
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.primer);

    await press(root, "Not now");
    expect(title(root)).toBe(SETUP_TITLES.invite);
  });

  it("ends at chat after the primer when the new chapter isn't active", async () => {
    pushAvailable = true;
    permission = { granted: false };
    selectChapter.mockResolvedValue(false);
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.primer);
    await press(root, "Not now");
    expect(useRouter().replace).toHaveBeenCalledWith("/(tabs)");
    expect(control(root, "Share invite")).toBeUndefined();
  });

  it("moves on to the invite even when the OS prompt fails", async () => {
    pushAvailable = true;
    permission = { granted: false };
    requestPushPermission.mockRejectedValue(new Error("native module"));
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Continue");
    await press(root, "Turn on notifications");
    expect(title(root)).toBe(SETUP_TITLES.invite);
  });

  it("skips it when this build can't push", async () => {
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.invite);
  });

  it("skips it when notifications are already on", async () => {
    pushAvailable = true;
    permission = { granted: true };
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.invite);
  });

  it("draws the same step a joining member sees, answers pinned", async () => {
    pushAvailable = true;
    permission = { granted: false };
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Continue");
    expect(title(root)).toBe("Turn on notifications");
    expect(allText(root)).toContain(
      "DMs, mentions, #general, and #announcements",
    );
    expect(control(root, "Turn on notifications")).toBeDefined();
    expect(control(root, "Not now")).toBeDefined();
  });
});

/** A Pressable's resting fill. */
const fillOf = (pressable: Node | undefined): unknown =>
  flatStyle(pressable?.props.style).backgroundColor;

/**
 * The invite step's one gold button is `Share invite` (owner pick 2026-11-06,
 * "Share first"). Each press mints a fresh link and shares it, since a link
 * lets one person in; no link is minted before a press, and no token is ever
 * drawn. Leaving is the quiet line under it.
 */
describe("chapter setup — invite", () => {
  async function toInvite(): Promise<Node> {
    const { root } = await render();
    await createFromMatch(root);
    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.invite);
    return root;
  }

  const sharedText = (call: number): string =>
    JSON.stringify(vi.mocked(Share.share).mock.calls[call]);

  it("leads with Share invite in gold and mints nothing until it is pressed", async () => {
    const root = await toInvite();

    const share = control(root, "Share invite");
    expect(fillOf(share)).toBe(signetDarkTokens.color.gold.house);
    // The platform's share mark, in the button's ink.
    const glyph = share!.findByType(ShareGlyph);
    expect(glyph.props.color).toBe(signetDarkTokens.color.gold.onHouse);
    expect(fillOf(control(root, "Skip for now"))).toBeUndefined();
    const text = allText(root);
    expect(text).toContain("A new link for each person");
    expect(text).toContain("app.frapp.live, good for 24 hours");
    expect(text).toContain(
      "Send each person their own link. A link lets one person in and lasts 24 hours.",
    );
    expect(text).not.toContain("Create another link");

    await press(root, "Skip for now");
    expect(useRouter().replace).toHaveBeenCalledWith("/(tabs)");
    // Skipping leaves no invite behind.
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("mints a fresh link for each press and shares it with the chapter's name", async () => {
    const root = await toInvite();

    await press(root, "Share invite");
    expect(createInvite).toHaveBeenCalledTimes(1);
    expect(Share.share).toHaveBeenLastCalledWith({
      message: expect.stringContaining("Join FIJI on Frapp"),
    });
    expect(sharedText(0)).toContain("/join?token=tok123");
    expect(allText(root)).not.toContain("tok123");
    expect(allText(root)).toContain("Link 1");
    expect(allText(root)).toContain("Not used yet");
    expect(control(root, "Go to chat")).toBeDefined();

    createInvite.mockResolvedValueOnce({ token: "tok456" });
    await press(root, "Share invite");
    expect(createInvite).toHaveBeenCalledTimes(2);
    expect(sharedText(1)).toContain("tok456");
    expect(allText(root)).toContain("Link 2");
  });

  it("keeps the link when the sheet is closed without sending", async () => {
    const root = await toInvite();
    vi.mocked(Share.share).mockResolvedValueOnce({
      action: "dismissedAction",
    });

    await press(root, "Share invite");
    expect(allText(root)).not.toContain("Link 1");
    expect(control(root, "Skip for now")).toBeDefined();

    await press(root, "Share invite");
    expect(createInvite).toHaveBeenCalledTimes(1);
    expect(sharedText(1)).toContain("tok123");
    expect(allText(root)).toContain("Link 1");
  });

  it("watches the invites only once a link is out, and marks one Joined when used", async () => {
    const root = await toInvite();
    expect(invitesOptions?.enabled).toBe(false);

    await press(root, "Share invite");
    expect(invitesOptions).toEqual({
      enabled: true,
      refetchInterval: INVITE_WATCH_INTERVAL_MS,
    });
    expect(allText(root)).toContain("Not used yet");

    inviteList = [{ token: "tok123", used_at: "2026-11-06T20:00:00Z" }];
    createInvite.mockResolvedValueOnce({ token: "tok456" });
    await press(root, "Share invite");
    expect(allText(root)).toContain("Joined");
  });

  it("makes one link for a second press while the first is minting", async () => {
    const root = await toInvite();
    let resolve!: (value: { token: string }) => void;
    createInvite.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const share = control(root, "Share invite")!;
    await act(async () => {
      share.props.onPress();
    });
    // Busy while it waits: the button holds still and can't be pressed.
    expect(control(root, "Share invite")!.props.disabled).toBe(true);
    await act(async () => {
      share.props.onPress();
    });
    await act(async () => {
      resolve({ token: "tok123" });
    });
    await settle();

    expect(createInvite).toHaveBeenCalledTimes(1);
    expect(allText(root)).toContain("Link 1");
    expect(allText(root)).not.toContain("Link 2");
  });

  it("says so when the link can't be made, and tries again on the next press", async () => {
    createInvite.mockReset().mockRejectedValueOnce(new Error("Offline"));
    const root = await toInvite();

    await press(root, "Share invite");
    expect(Share.share).not.toHaveBeenCalled();
    expect(allText(root)).toContain("Offline");

    createInvite.mockResolvedValueOnce({ token: "tok789" });
    await press(root, "Share invite");
    expect(sharedText(0)).toContain("tok789");
    expect(allText(root)).not.toContain("Offline");
  });

  it("points to the web dashboard when the share sheet won't open", async () => {
    const root = await toInvite();
    vi.mocked(Share.share).mockRejectedValueOnce(new Error("no activity"));

    await press(root, "Share invite");
    expect(allText(root)).toContain(SHARE_FAILED_MESSAGE);
    expect(allText(root)).not.toContain("Link 1");
  });
});

/**
 * The identity form moves down itself on Return instead of dropping the
 * keyboard after every field, and capitalizes names as names.
 */
describe("chapter setup — identity fields", () => {
  const focused: string[] = [];

  async function renderWithFocus(): Promise<Node> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <QueryClientProvider client={queryClient}>
          <FrappThemeProvider>
            <CreateChapter />
          </FrappThemeProvider>
        </QueryClientProvider>,
        {
          // A field's ref, so moving focus can be seen.
          createNodeMock: (element) => ({
            focus: () =>
              focused.push(
                String(
                  (element.props as { accessibilityLabel?: string })
                    .accessibilityLabel,
                ),
              ),
          }),
        },
      );
    });
    await settle();
    return tree.root;
  }

  function field(root: Node, label: string): Node {
    const input = root
      .findAllByType("TextInput" as never, { deep: true })
      .find((i) => i.props.accessibilityLabel === label);
    if (!input) throw new Error(`No field "${label}"`);
    return input;
  }

  beforeEach(() => {
    focused.length = 0;
  });

  it("chains Return through every field drawn, and ends on Done", async () => {
    const root = await renderWithFocus();
    await pickRow(root, "Sigma Phi Epsilon");
    await press(root, "Edit details");

    const order = [
      "Organization",
      "School",
      "Chapter",
      "Short name",
      "Greek letters",
      "School short name",
    ];
    for (const [index, label] of order.entries()) {
      const input = field(root, label);
      expect(input.props.returnKeyType).toBe("next");
      act(() => {
        input.props.onSubmitEditing();
      });
      expect(focused[index]).toBe(
        index + 1 < order.length ? order[index + 1] : "Founded",
      );
    }
    const last = field(root, "Founded");
    expect(last.props.returnKeyType).toBe("done");
    expect(last.props.maxLength).toBe(4);
  });

  it("skips the letters field for an organization that hides its letters", async () => {
    const root = await renderWithFocus();
    await pickRow(root, "Phi Gamma Delta");
    await press(root, "Edit details");

    // FIJI draws no letters field, so Return on Short name goes on to the
    // next field that is drawn rather than to one that isn't there.
    expect(
      root
        .findAllByType("TextInput" as never, { deep: true })
        .some((i) => i.props.accessibilityLabel === "Greek letters"),
    ).toBe(false);
    const shortName = field(root, "Short name");
    expect(shortName.props.returnKeyType).toBe("next");
    act(() => {
      shortName.props.onSubmitEditing();
    });
    expect(focused).toEqual(["School short name"]);
  });

  it("skips a field the step hides: by hand with details closed, School is last", async () => {
    const root = await renderWithFocus();
    await press(root, "Not in our directory?");

    expect(field(root, "Organization").props.returnKeyType).toBe("next");
    expect(field(root, "School").props.returnKeyType).toBe("done");
    // No line between the title and the fields.
    expect(allText(root)).not.toContain("next officer finds it");
  });

  it("capitalizes names as names", async () => {
    const root = await renderWithFocus();
    await press(root, "Not in our directory?");
    await press(root, "More details");

    for (const label of ["Organization", "School", "Chapter"]) {
      expect(field(root, label).props.autoCapitalize).toBe("words");
    }
    expect(field(root, "Short name").props.autoCapitalize).toBe("characters");
  });

  it("edges the field being typed in, in house gold", async () => {
    const root = await renderWithFocus();
    await press(root, "Not in our directory?");
    const borderOf = () =>
      Object.assign(
        {},
        ...(
          field(root, "Organization").props.style as (Record<
            string,
            unknown
          > | null)[]
        ).filter(Boolean),
      ).borderColor;

    expect(borderOf()).toBe(signetDarkTokens.color.border.input);
    act(() => {
      field(root, "Organization").props.onFocus();
    });
    expect(borderOf()).toBe(signetDarkTokens.color.gold.askText);
  });

  it("opens the find step on the field, with no line restating its placeholder", async () => {
    const root = await renderWithFocus();

    expect(allText(root)).not.toContain("fill in the rest");
    expect(field(root, "Search the chapter directory").props.placeholder).toBe(
      "Organization or school",
    );
  });
});

/**
 * Each step fades in, and the mark zooms in on the live step, but neither
 * moves for a member who reduces motion: the reanimated mock keeps the
 * setting each builder was given.
 */
describe("chapter setup — motion", () => {
  function entering(root: Node): { reduceMotionMode?: string }[] {
    return root
      .findAllByType("Animated.View" as never, { deep: true })
      .map((view) => view.props.entering as { reduceMotionMode?: string });
  }
  const stepFade = expect.objectContaining({
    animation: "FadeIn",
    durationMs: signetDarkTokens.motion.duration.standard,
    reduceMotionMode: ReduceMotion.System,
  });

  it("fades every step in, and holds still for reduced motion", async () => {
    const { root } = await render();
    expect(entering(root)).toEqual([stepFade]);

    await pickRow(root, "Phi Gamma Delta");
    await press(root, "Continue");
    expect(title(root)).toBe(SETUP_TITLES.color);
    expect(entering(root)).toEqual([stepFade]);

    await press(root, "agree");
    await act(async () => {
      primary(root).props.onPress();
    });
    await settle();
    // The mark's zoom above the step, then the step's fade.
    expect(title(root)).toBe("FIJI is live");
    expect(entering(root)).toEqual([
      expect.objectContaining({
        animation: "ZoomIn",
        reduceMotionMode: ReduceMotion.System,
      }),
      stepFade,
    ]);
  });
});
