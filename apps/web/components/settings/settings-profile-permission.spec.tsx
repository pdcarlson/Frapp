import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * The page's own `canEditProfile` wiring (#2575).
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

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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
    // `manage` without `view`: the route needs both, like every other
    // `chapter-config:manage` route.
    ["chapter-config:manage alone", ["chapter-config:manage"]],
    ["chapter-config:view alone", ["chapter-config:view"]],
  ])("disables both for %s", async (_label, granted) => {
    permissions.current = granted;
    expect(await profileSaves()).toEqual({
      profileEnabled: false,
      accentEnabled: false,
    });
  });
});
