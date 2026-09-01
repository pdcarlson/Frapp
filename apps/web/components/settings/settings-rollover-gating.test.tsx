import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockUpdateChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockUpdateChapter: vi.fn(),
}));

const PERMISSIONS = [
  "chapter-config:manage",
  "semester:rollover",
  "billing:view",
  "billing:manage",
];

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: PERMISSIONS },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChapter: () => ({ mutateAsync: mockUpdateChapter, isPending: false }),
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

// The permission gate has its own tests; here it must not swallow the controls.
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { SettingsPage } = await import("./settings-page");

const chapter = chapterSubscription(mockCurrentChapter);

const rolloverButton = () =>
  screen.getByRole("button", { name: /archive current semester/i });
const saveProfileButton = () =>
  screen.getByRole("button", { name: /save profile/i });
const portalButton = () =>
  screen.getByRole("button", { name: /open stripe billing portal/i });

describe("settings semester rollover subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves the rollover control alone on an active chapter", () => {
    chapter.active();
    render(<SettingsPage />);

    expect(rolloverButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the rollover and names the blocker when incomplete", () => {
    chapter.incomplete();
    render(<SettingsPage />);

    expect(rolloverButton()).toBeDisabled();
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
  });

  it("ties the disabled rollover to the one explanation", () => {
    chapter.incomplete();
    render(<SettingsPage />);

    const describedBy = rolloverButton().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /restore semester rollover/i,
    );
  });

  it("leaves the other settings writes alone — they are not paid-ops", () => {
    // `SemesterRolloverController` is the only paid-ops controller behind this
    // screen. Chapter profile (`chapter`) and org config (`chapter-config`) are
    // `@FreeTier`, and `billing` is exempt because it is the recovery path
    // (§5 rule 3). Gating them would lock a lapsed chapter out of settings it
    // is still entitled to change.
    chapter.incomplete();
    render(<SettingsPage />);

    expect(saveProfileButton()).toBeEnabled();
    expect(portalButton()).toBeEnabled();
  });

  it("leaves the accent-color write alone too", async () => {
    // Lives on the Theme tab, so it only mounts once that tab is selected —
    // and it patches `chapter`, another `@FreeTier` route.
    chapter.incomplete();
    render(<SettingsPage />);

    await userEvent.click(screen.getByRole("tab", { name: /theme/i }));

    expect(
      screen.getByRole("button", { name: /save accent color/i }),
    ).toBeEnabled();
  });

  it("never gates the rollover form's own fields", () => {
    // They hold local state — the write is the submit, and disabling that also
    // suppresses implicit Enter submission. Matches the reference consumer,
    // which leaves its dialog fields alone as well.
    chapter.incomplete();
    render(<SettingsPage />);

    expect(screen.getByLabelText(/^label$/i)).toBeEnabled();
    expect(screen.getByLabelText(/start date/i)).toBeEnabled();
    expect(screen.getByLabelText(/end date/i)).toBeEnabled();
  });

  it("fails open when the subscription status cannot be established", () => {
    // Deliberately asymmetric with `<Can>`, which fails closed. A status this
    // client does not model must not lock a chapter that is most likely paying.
    chapter.raw("trialing");
    render(<SettingsPage />);

    expect(rolloverButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asserts no blocker when the chapter record cannot be read", () => {
    // The gate and this page share one `useCurrentChapter` query (§5 "read
    // subscription state from one place"), so a failed fetch takes the whole
    // screen to its error state before any control renders. The gate's job here
    // is the negative one: never claim a reason nothing established.
    chapter.unreadable();
    render(<SettingsPage />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/couldn't load chapter settings/i),
    ).toBeInTheDocument();
  });
});

describe("the accent preview reports its own legibility", () => {
  /*
   * `resolveChapterAccentColor` asks whether the accent is legible *as text on
   * the card*; a primary button needs the other question, whether text is
   * legible *on the accent*. They diverge, and the pre-push review found the
   * band where: `#0080FD` passes the first with `reason: "ok"` and no warning,
   * and fails the second at 4.191:1. Before this, the swatch drew "Preview" in
   * a tone `pickAccessibleColor` had explicitly rejected and said nothing.
   *
   * `settings-contrast.test.ts` measures the tones. This asserts the screen
   * actually surfaces the verdict, which no measurement can.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("warns when label text on the typed accent misses AA", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole("tab", { name: /theme/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);
    await user.clear(hex);
    await user.type(hex, "#0080FD");
    expect(
      screen.getByText(/under the 4\.5:1 minimum/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/4\.2:1/)).toBeInTheDocument();
  });

  it("stays quiet for an accent whose label text is legible", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole("tab", { name: /theme/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);
    await user.clear(hex);
    await user.type(hex, "#F2B72E");
    expect(screen.queryByText(/under the 4\.5:1 minimum/i)).toBeNull();
  });
});

describe("the accent form surfaces the server's own §8 disclosure (#1183)", () => {
  /*
   * A third, independent question from the pair above — those are client-side
   * checks of the unsaved draft against one fixed backdrop each, computed by
   * `resolveChapterAccentColor`/`pickAccessibleColor`. This is the real
   * Signet engine's verdict on the colour actually saved, returned by
   * `PATCH /v1/chapters/current` and disclosed rather than corrected: §8
   * forbids a runtime substitution, so a failing save still succeeds.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  async function saveAccent(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: /theme/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);
    await user.clear(hex);
    await user.type(hex, "#222222");
    await user.click(screen.getByRole("button", { name: /save accent color/i }));
  }

  it("names the failing role, its ratio, and a next action", async () => {
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [
        { role: "--signet-accent-text", against: "#0E0D0B", ratio: 3.21 },
      ],
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await saveAccent(user);

    expect(
      screen.getByText(/accent text on the app background reads at 3\.2:1/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/under the 4\.5:1 minimum/i)).toBeInTheDocument();
    expect(
      screen.getByText(/try a lighter or darker shade of this hue/i),
    ).toBeInTheDocument();
  });

  it("stays quiet when the save reports no failing checks", async () => {
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [],
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await saveAccent(user);

    expect(screen.queryByText(/under the 4\.5:1 minimum/i)).toBeNull();
  });

  it("clears the warning as soon as the officer edits the draft again", async () => {
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [
        { role: "--signet-accent-on-primary", against: "--signet-accent-primary", ratio: 2.5 },
      ],
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await saveAccent(user);
    expect(screen.getByText(/under the 4\.5:1 minimum/i)).toBeInTheDocument();

    const hex = screen.getByLabelText(/accent color hex value/i);
    await user.type(hex, "1");

    // A stale server verdict describing a colour the officer already changed
    // away from would be actively misleading — it must not survive the edit.
    expect(screen.queryByText(/under the 4\.5:1 minimum/i)).toBeNull();
  });

  it("clears the warning when the chapter data resyncs out from under it", async () => {
    // Not a manual edit — a chapter switch, another tab's save, or a
    // background refetch all resync `accentDraft` from `chapterQuery.data`
    // via the same effect. That effect must clear the warning too, or it
    // survives describing a colour this render no longer shows.
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [
        { role: "--signet-accent-text", against: "#0E0D0B", ratio: 3.21 },
      ],
    });
    const user = userEvent.setup();
    const { rerender } = render(<SettingsPage />);

    await saveAccent(user);
    expect(screen.getByText(/under the 4\.5:1 minimum/i)).toBeInTheDocument();

    mockCurrentChapter.mockReturnValue({
      data: {
        name: "Tau Nu",
        university: "State U",
        subscription_status: "active",
        accent_color: "#7FD1AE",
      },
      isPending: false,
      isError: false,
    });
    rerender(<SettingsPage />);

    expect(screen.queryByText(/under the 4\.5:1 minimum/i)).toBeNull();
  });

  it("gives every failing check its own contrast clause, not just the last", async () => {
    // A join that appends the floor clause once, after the whole list, reads
    // as though only the final check is the one that failed.
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [
        { role: "--signet-accent-text", against: "#0E0D0B", ratio: 3.21 },
        {
          role: "--signet-accent-on-primary",
          against: "--signet-accent-primary",
          ratio: 2.5,
        },
      ],
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await saveAccent(user);

    const warning = screen.getByText(
      /accent text on the app background/i,
    ).textContent!;
    expect(warning).toMatch(/reads at 3\.2:1, under the 4\.5:1 minimum\./);
    expect(warning).toMatch(
      /reads at 2\.5:1, under the 4\.5:1 minimum\./,
    );
  });
});
