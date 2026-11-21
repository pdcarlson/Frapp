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

vi.mock("@repo/hooks", async () =>
  (await import("@/tests/settings-harness")).settingsHooks({
    currentChapter: () => mockCurrentChapter(),
    permissions: () => [
      "chapter-config:view",
      "chapter-config:manage",
      "geofences:manage",
    ],
    orgConfig: () => ({ org_archetype: "ifc", enabled_modules: {} }),
  }),
);

// Mutable so a test can start with no active chapter, which is how zustand's
// `persist` cold-starts before it rehydrates.
let activeChapterId: string | null = "chap-1";

vi.mock("@/lib/stores/chapter-store", async () =>
  (await import("@/tests/settings-harness")).chapterStore(
    () => activeChapterId,
  ),
);

vi.mock("next/navigation", async () =>
  (await import("@/tests/settings-harness")).navigation(() => searchParams),
);

vi.mock("@/components/shared/can", async () =>
  (await import("@/tests/settings-harness")).canPassThrough(),
);

vi.mock("@/lib/hooks/use-toast", async () =>
  (await import("@/tests/settings-harness")).toastStub(),
);

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
    expect(
      screen.getByRole("region", { name: "Zone list" }),
    ).toBeInTheDocument();
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
    expect(
      screen.getByRole("region", { name: "Zone list" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load chapter settings"),
    ).not.toBeInTheDocument();
  });
});
