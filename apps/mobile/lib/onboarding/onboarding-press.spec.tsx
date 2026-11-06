/** @vitest-environment jsdom */
import React, { type ComponentProps, type ReactElement } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappClientProvider, type ChapterDirectoryResult } from "@repo/hooks";
import { FrappThemeProvider, tint } from "@/lib/theme";
import { flatStyle } from "@/test/flat-style";

/**
 * Every control the flow moved onto `OnboardingPressable` presses the way its
 * kind does: a ripple on Android, where the fill doesn't also change, and a
 * held style on iOS. One row per control, rendered where a member meets it, so
 * a call site that drops `quiet`, or goes back to a plain `Pressable`, fails
 * here rather than only looking wrong on a phone.
 *
 * Here, not beside the screens: a spec under `app/` is a route module
 * (`lib/routes.spec.ts`).
 */

const auth = vi.hoisted(() => ({
  status: "authenticated" as "authenticated" | "unauthenticated",
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: auth.status,
    chapterId: "chapter-tau-nu",
    email: "brother@westfield.edu",
    isConfigured: true,
    callbackError: null,
    sendMagicLink: vi.fn(),
    signInWithOAuthProvider: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/lib/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/notifications/push", () => ({
  isPushAvailable: () => false,
  getPushPermission: () => Promise.resolve(null),
  requestPushPermission: vi.fn(),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));

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

const state = vi.hoisted(() => ({
  directoryError: false,
  chapters: { data: [] as unknown[], isError: false },
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useListChapters: () => ({
    data: state.chapters.data,
    isPending: false,
    isError: state.chapters.isError,
    refetch: vi.fn(),
  }),
  useChapterDirectorySearch: () => ({
    data: state.directoryError ? [] : [FIJI_ROW],
    isFetching: false,
    isError: state.directoryError,
    refetch: vi.fn(),
  }),
  useOnboardChapter: () => ({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({ id: "chapter-new" }),
  }),
  useCreateInvite: () => ({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue({ token: "tok123" }),
  }),
  useCurrentChapter: () => ({ data: { logo_url: null } }),
  useRequestChapterLogoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmChapterLogo: () => ({ mutateAsync: vi.fn() }),
  useChannels: () => ({ isPending: false, isError: false, data: [] }),
  useRedeemInvite: () => ({
    isPending: false,
    isSuccess: false,
    mutateAsync: vi.fn(),
  }),
  useAcceptLegalTerms: () => ({
    isPending: false,
    isSuccess: false,
    mutateAsync: vi.fn(),
  }),
  useDeleteAccount: () => ({
    isPending: false,
    isSuccess: false,
    mutateAsync: vi.fn(),
  }),
}));

import ChapterPicker from "@/app/(auth)/chapter-picker";
import CreateChapter from "@/app/(auth)/create-chapter";
import JoinChapter from "@/app/(auth)/join";
import SignIn from "@/app/(auth)/sign-in";
import TermsPrompt from "@/app/(auth)/terms";
import { ClientPolicyGate } from "@/components/client-policy-gate";

const policy = vi.hoisted(() => ({
  current: { updateRequired: true, updateUrl: "https://a.test/app" },
}));
vi.mock("@/lib/client-policy", () => ({
  useClientPolicy: () => policy.current,
}));

type Node = ReactTestRenderer["root"];

/** Never answers a read, and fails a write, so nothing on screen moves. */
const client = {
  GET: () => new Promise(() => {}),
  POST: () => Promise.reject(new Error("offline")),
};

async function settle(ms = 10): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }
}

async function render(screen: ReactElement): Promise<Node> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappClientProvider
          client={
            client as unknown as ComponentProps<
              typeof FrappClientProvider
            >["client"]
          }
          chapterId={null}
        >
          <FrappThemeProvider>{screen}</FrappThemeProvider>
        </FrappClientProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return tree.root;
}

/** The pressable whose label, or its own rendered text, is `label`. */
function control(root: Node, label: string): Node {
  const found = root
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
  if (!found) throw new Error(`No control "${label}"`);
  return found;
}

/** A document link, by its label: the checkbox row's label names both. */
function link(root: Node, label: string): Node {
  return root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "link" &&
      node.props.accessibilityLabel === label,
  );
}

async function press(root: Node, label: string): Promise<void> {
  const target = control(root, label);
  await act(async () => {
    target.props.onPress();
  });
  await settle();
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

/** Setup, from a FIJI match to the invite step. */
async function setupInvite(): Promise<Node> {
  const root = await render(<CreateChapter />);
  await press(root, "Phi Gamma Delta");
  await press(root, "Continue");
  await press(root, "agree");
  const pressables = root.findAllByType("Pressable" as never, { deep: true });
  await act(async () => {
    pressables[pressables.length - 1].props.onPress();
  });
  await settle();
  await press(root, "Continue");
  return root;
}

const { color } = signetDarkTokens;
/** `OnboardingPressable`'s default ripple, `ListRow`'s neutral one. */
const NEUTRAL = tint(color.text.foreground, 0.12);

type Kind = {
  ripple: string;
  /** What a held press adds on iOS. */
  held: Record<string, unknown>;
  /** The same keys on Android, where the ripple shows instead. */
  androidHeld: Record<string, unknown>;
};

const QUIET: Kind = {
  ripple: NEUTRAL,
  held: { opacity: 0.6 },
  androidHeld: { opacity: undefined },
};
const FILLED: Kind = {
  ripple: NEUTRAL,
  held: { opacity: 0.85 },
  androidHeld: { opacity: undefined },
};
const PRIMARY: Kind = {
  ripple: tint(color.gold.onHouse, 0.16),
  held: { opacity: 0.85 },
  androidHeld: { opacity: undefined },
};
const TINTED: Kind = {
  ripple: tint(color.gold.house, 0.2),
  held: { backgroundColor: tint(color.gold.house, 0.2) },
  androidHeld: { backgroundColor: tint(color.gold.house) },
};

const ROWS: [string, Kind, () => Promise<Node>][] = [
  // Terms prompt.
  [
    "terms: Sign out",
    QUIET,
    async () => control(await render(<TermsPrompt />), "Sign out"),
  ],
  [
    "terms: Delete account",
    QUIET,
    async () => control(await render(<TermsPrompt />), "Delete account"),
  ],
  [
    "terms: the Terms checkbox row",
    QUIET,
    async () =>
      (await render(<TermsPrompt />)).find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "checkbox",
      ),
  ],
  [
    "terms: the Terms of Service link",
    QUIET,
    async () => link(await render(<TermsPrompt />), "Terms of Service"),
  ],
  [
    "terms: the Privacy Policy link",
    QUIET,
    async () => link(await render(<TermsPrompt />), "Privacy Policy"),
  ],
  // Sign-in.
  [
    "sign-in: Other ways to sign in",
    QUIET,
    async () => {
      auth.status = "unauthenticated";
      // Off iOS, Apple waits behind this line.
      const os = vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
      const root = await render(<SignIn />);
      os.mockRestore();
      return control(root, "Other ways to sign in");
    },
  ],
  ...(["Password", "Magic link"] as const).map(
    (label): [string, Kind, () => Promise<Node>] => [
      `sign-in: the ${label} mode button`,
      FILLED,
      async () => {
        auth.status = "unauthenticated";
        const root = await render(<SignIn />);
        await press(root, "Continue with email");
        return control(root, label);
      },
    ],
  ),
  // Join.
  [
    "join: Account",
    QUIET,
    async () => control(await render(<JoinChapter />), "Account"),
  ],
  // Chapter picker.
  [
    "picker: Sign out",
    QUIET,
    async () => control(await render(<ChapterPicker />), "Sign out"),
  ],
  [
    "picker: Try again",
    TINTED,
    async () => {
      state.chapters = { data: [], isError: true };
      return control(await render(<ChapterPicker />), "Try again");
    },
  ],
  [
    "picker: Join or start a chapter",
    TINTED,
    async () =>
      control(await render(<ChapterPicker />), "Join or start a chapter"),
  ],
  // Setup.
  [
    "setup: Retry",
    QUIET,
    async () => {
      state.directoryError = true;
      const root = await render(<CreateChapter />);
      typeInto(root, "Search the chapter directory", "Phi Gamma");
      // Past the search's debounce.
      await settle(60);
      return control(root, "Retry");
    },
  ],
  [
    "setup: Edit details",
    QUIET,
    async () => {
      const root = await render(<CreateChapter />);
      await press(root, "Phi Gamma Delta");
      return control(root, "Edit details");
    },
  ],
  [
    "setup: Skip for now",
    QUIET,
    async () => control(await setupInvite(), "Skip for now"),
  ],
  // The update-required gate, which renders the onboarding primary.
  [
    "gate: Update Frapp",
    PRIMARY,
    async () =>
      control(
        await render(
          <ClientPolicyGate>
            <></>
          </ClientPolicyGate>,
        ),
        "Update Frapp",
      ),
  ],
];

beforeEach(() => {
  auth.status = "authenticated";
  state.directoryError = false;
  state.chapters = { data: [], isError: false };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onboarding press feedback", () => {
  it.each(ROWS)("%s", async (_name, kind, reach) => {
    const pressable = await reach();
    expect(pressable.props.android_ripple).toEqual({ color: kind.ripple });
    expect(flatStyle(pressable.props.style, true)).toEqual(
      expect.objectContaining(kind.held),
    );

    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    const held = flatStyle(pressable.props.style, true);
    for (const [key, value] of Object.entries(kind.androidHeld)) {
      expect(held[key]).toBe(value);
    }
  });
});
