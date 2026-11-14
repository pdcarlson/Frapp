import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// `@repo/validation`'s beta list, emptied so this spec pins the ordinary
// module rule with dues as its example. A test that wants dues beta-off, as
// it is for the beta, sets `betaOff.keys`.
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation/beta-off-modules", () => ({
  get BETA_OFF_MODULES() {
    return betaOff.keys;
  },
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));
afterEach(() => {
  betaOff.keys = [];
});

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

let searchParams = new URLSearchParams();

vi.mock("@repo/hooks", () => ({
  // A server with AI off: no AI row (#4308).
  useAiConsent: () => ({ data: null }),
  aiAvailableFrom: () => false,
  isFirstAiReadInFlight: () => false,
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: {
      permissions: [
        "chapter-config:view",
        "chapter-config:manage",
        "geofences:manage",
      ],
    },
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
  useChannels: () => ({ data: [] }),
  useOrgConfig: () => ({
    data: { org_archetype: "ifc", enabled_modules: {} },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePatchOrgConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingConfigKeys: () => new Set<string>(),
  useRoles: () => ({ data: [], isPending: false, isError: false }),
}));

// Mutable so a test can start with no active chapter, which is how zustand's
// `persist` cold-starts before it rehydrates.
let activeChapterId: string | null = "chap-1";

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The zone list's own behavior is study-zones-manager.spec.tsx's; here it
// only has to show up in the right place.
vi.mock("@/components/geofences/study-zones-manager", () => ({
  StudyZonesManager: () => <section aria-label="Zone list" />,
}));

const { SettingsPage } = await import("./settings-page");

/**
 * Study zones opens inside Chapter settings (Paul, 2026-11-12): its zone list
 * is part of the Study zones page, not a link to a route of its own that
 * brought chat back with a settings drawer beside it.
 */
describe("Study zones inside Chapter settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentChapter.mockReturnValue({
      data: { id: "chap-1", name: "Test", subscription_status: "active" },
      isPending: false,
      isError: false,
    });
    searchParams = new URLSearchParams("tab=geofences");
    activeChapterId = "chap-1";
  });

  it("draws the zone list on the Study zones page, with no link out", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("region", { name: "Zone list" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /study zones/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the page, and a half-drawn zone, when a background refetch fails", () => {
    mockCurrentChapter.mockReturnValue({
      data: { id: "chap-1", name: "Test", subscription_status: "active" },
      isPending: false,
      isError: true,
      error: new Error("boom"),
      refetch: vi.fn(),
    });
    render(<SettingsPage />);
    expect(screen.getByRole("region", { name: "Zone list" })).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load chapter settings"),
    ).not.toBeInTheDocument();
  });
});
