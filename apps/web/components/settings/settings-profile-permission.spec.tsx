import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * The page's own chapter-profile wiring: the `canEditProfile` gate (#2575),
 * and what the profile and accent fields are seeded with (#2844).
 *
 * `settings-org-tab.spec.tsx` pins that the tab honours the prop it is given,
 * and `chapter.controller.spec.ts` pins the routes to
 * `CHAPTER_PROFILE_PERMISSIONS`. Neither sees what `settings-page.tsx` derives
 * the prop from, and the other page-level specs grant permission sets that
 * would pass whichever gate it read. So this renders the real page per
 * permission set and asserts both saves the constant gates: Save profile on
 * the Chapter tab, and Save accent color on the Accent tab.
 */

const { mockCurrentChapter, permissions } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  permissions: { current: [] as string[] },
}));

// The config read is stubbed as loaded for every set, including the ones the
// real API would refuse it to: this spec is about the save gates, and a failed
// config read would hide the Chapter tab's form behind `renderConfigGated`.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: permissions.current },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrgConfig: () => ({
    data: { org_archetype: "ifc" },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePatchOrgConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingConfigKeys: () => new Set<string>(),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { SettingsPage } = await import("./settings-page");

const chapter = chapterSubscription(mockCurrentChapter);

/** Both saves `CHAPTER_PROFILE_PERMISSIONS` gates, read off the real page. */
async function profileSaves() {
  const user = userEvent.setup();
  render(<SettingsPage />);

  await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
  const profile = screen.getByRole("button", { name: /save profile/i });
  const profileEnabled = !(profile as HTMLButtonElement).disabled;

  await user.click(screen.getByRole("tab", { name: /accent/i }));
  // A savable draft first: an empty one disables Save for its own reason.
  await user.type(screen.getByLabelText(/accent color hex value/i), "#8B0000");
  const accent = screen.getByRole("button", { name: /save accent color/i });
  const accentEnabled = !(accent as HTMLButtonElement).disabled;

  return { profileEnabled, accentEnabled };
}

describe("the Settings page gates profile and accent saves on CHAPTER_PROFILE_PERMISSIONS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it.each([
    [
      "chapter-config:view and chapter-config:manage",
      ["chapter-config:view", "chapter-config:manage"],
    ],
    ["the wildcard", ["*"]],
  ])("enables both for %s", async (_label, granted) => {
    permissions.current = granted;
    expect(await profileSaves()).toEqual({
      profileEnabled: true,
      accentEnabled: true,
    });
  });

  it.each([
    // The API refuses this pair since #2575, so the page must not offer it.
    [
      "the permissions the API admitted before #2575",
      ["chapter-config:view", "roles:manage", "billing:manage"],
    ],
    ["chapter-config:view alone", ["chapter-config:view"]],
  ])("disables both for %s", async (_label, granted) => {
    permissions.current = granted;
    expect(await profileSaves()).toEqual({
      profileEnabled: false,
      accentEnabled: false,
    });
  });

  it("offers chapter-config:manage alone neither tab, since the config read needs view", () => {
    // `manage` without `view` could never save here: the route needs both, like
    // every other `chapter-config:manage` route, and the whole config
    // controller is guarded on `view`. Since #2946 Settings hides tabs the
    // viewer cannot use, so the saves are not reachable at all.
    permissions.current = ["chapter-config:manage"];
    render(<SettingsPage />);
    expect(screen.queryByRole("tab", { name: /^chapter$/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /accent/i })).toBeNull();
  });
});

/*
 * The page reads `GET /v1/chapters/current` through its contract type. It used
 * to run the payload through a zod twin of that type first, and a stored
 * `branding` value the twin refused (a pre-1776 founding year, a non-hex
 * accent) failed the whole parse: the profile form came up empty and the
 * accent draft never seeded, though `branding` feeds neither (#2844).
 */
describe("the Settings page seeds the chapter profile from the contract payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.current = ["*"];
  });

  it("fills the profile and accent fields when the chapter's branding is malformed", async () => {
    mockCurrentChapter.mockReturnValue({
      data: {
        subscription_status: "active",
        past_due_since: null,
        name: "Tau Nu",
        university: "RPI",
        donation_url: "https://donate.example/tau-nu",
        accent_color: "#8B0000",
        branding: { founded_at: 1500, colors: { accent: "gold" } },
      },
      isPending: false,
      isError: false,
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    expect(screen.getByLabelText("Chapter name")).toHaveValue("Tau Nu");
    expect(screen.getByLabelText("University")).toHaveValue("RPI");
    expect(screen.getByLabelText("Donation link (optional)")).toHaveValue(
      "https://donate.example/tau-nu",
    );

    await user.click(screen.getByRole("tab", { name: /accent/i }));
    expect(screen.getByLabelText(/accent color hex value/i)).toHaveValue(
      "#8B0000",
    );
  });
});
