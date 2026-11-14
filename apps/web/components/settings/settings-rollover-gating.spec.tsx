import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";
import * as accentPreviewInk from "@/components/settings/accent-preview-ink";

const { mockCurrentChapter, mockUpdateChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockUpdateChapter: vi.fn(),
}));

const PERMISSIONS = [
  // Both halves of `CHAPTER_PROFILE_PERMISSIONS`: the profile and accent saves
  // asserted below need `view` as well as `manage` (#2575).
  "chapter-config:view",
  "chapter-config:manage",
  "semester:rollover",
  "billing:view",
  "billing:manage",
];

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
vi.mock("@repo/hooks", () => ({
  // A server with AI off: no AI row (#4308).
  useAiConsent: () => ({ data: null }),
  aiAvailableFrom: () => false,
  isFirstAiReadInFlight: () => false,
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: PERMISSIONS },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChapter: () => ({
    mutateAsync: mockUpdateChapter,
    isPending: false,
  }),
  useChannels: () => ({ data: [] }),
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
  // `tab=semester`: board `4d` gives Semester its own rail entry, so the
  // rollover form no longer sits at the bottom of the default Chapter tab.
  // Landing the page on the tab under test is also what the nav's own deep
  // links do.
  useSearchParams: () => new URLSearchParams("tab=semester"),
}));

// The permission gate has its own tests; here it must not swallow the controls.
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Plan and billing has its own specs (`plan-panel.spec.tsx` pins that its
// Stripe actions stay live on a lapsed chapter); here it only has to mount.
vi.mock("@/components/billing/plan-and-billing", () => ({
  PlanAndBilling: () => <p>Plan and billing section</p>,
}));

const { SettingsPage } = await import("./settings-page");

const chapter = chapterSubscription(mockCurrentChapter);

const rolloverButton = () =>
  screen.getByRole("button", { name: /archive current semester/i });
const saveProfileButton = () =>
  screen.getByRole("button", { name: /save profile/i });

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
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/settings?tab=billing");
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

  it("leaves the other settings writes alone — they are not paid-ops", async () => {
    // `SemesterRolloverController` is the only paid-ops controller behind this
    // screen. Chapter profile (`chapter`) and org config (`chapter-config`) are
    // `@FreeTier`, and `billing` is exempt because it is the recovery path
    // (§5 rule 3). Gating them would lock a lapsed chapter out of settings it
    // is still entitled to change.
    //
    // The two live on different rail entries since board `4d` split them —
    // profile on Chapter, billing on Plan and billing — and Radix unmounts
    // an inactive tab, so each is asserted on its own tab rather than both on
    // whichever one happens to be open.
    const user = userEvent.setup();
    chapter.incomplete();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    expect(saveProfileButton()).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: /plan and billing/i }));
    expect(screen.getByText("Plan and billing section")).toBeInTheDocument();
  });

  it("leaves the accent-color write alone too", async () => {
    // Lives on the Accent tab (board `4d`'s name for what was Theme), so it
    // only mounts once that tab is selected — and it patches `chapter`,
    // another `@FreeTier` route.
    chapter.incomplete();
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    // A savable draft first: an empty one disables Save for its own reason
    // (see "the accent save sends the colour the preview shows" below).
    await user.type(
      screen.getByLabelText(/accent color hex value/i),
      "#8B0000",
    );

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

describe("the accent preview draws its label in the ink previewInkFor picks", () => {
  /*
   * `resolveChapterAccentColor` asks whether the accent is legible *as text on
   * the card*; the swatch's label needs the other question, whether text is
   * legible *on the accent*, which `previewInkFor` answers. A warning used to
   * sit under the swatch for a kept colour whose best ink still missed AA;
   * since the 2026-11-12 ladder no kept colour reaches that band, and #4388
   * deleted it (`settings-contrast.spec.ts` sweeps the band).
   */
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("paints the swatch label in the ink previewInkFor picks", async () => {
    // A real accent can't show it: on today's ladder `onHouse` wins for every
    // colour the resolver keeps (keeping it takes 4.5:1 on the dark card, past
    // the two tones' crossover), and `onHouse` is also the fallback a
    // hard-coded swatch would reach for. So for the typed colour, and only for
    // it, the ink is a sentinel neither tone is: the swatch must paint it.
    const real = accentPreviewInk.previewInkFor;
    const spy = vi
      .spyOn(accentPreviewInk, "previewInkFor")
      .mockImplementation((fill) =>
        fill.toUpperCase() === "#4DA3FF"
          ? { ink: "#123456", ratio: 3.27 }
          : real(fill),
      );
    try {
      const user = userEvent.setup();
      render(<SettingsPage />);
      await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
      const hex = screen.getByLabelText(/accent color hex value/i);
      await user.clear(hex);
      await user.type(hex, "#4DA3FF");
      expect(screen.getByText("Preview")).toHaveStyle({ color: "#123456" });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the accent save sends the colour the preview shows", () => {
  /*
   * The preview reads the draft through `normalizeHex`, which trims it and
   * expands 3-digit shorthand. The save used to send the raw draft, so `#08E`
   * previewed as `#0088EE` and then failed the DTO's `^#[0-9A-Fa-f]{6}$` with a
   * 400; an empty or blank draft sent no `accent_color`, which the API answers
   * as a successful no-op, so the toast claimed a save that wrote nothing.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [],
    });
  });

  const saveButton = () =>
    screen.getByRole("button", { name: /save accent color/i });
  const hexNeeded = () =>
    screen.queryByText(
      /enter a hex code like #5AA9E6 to save an accent color/i,
    );

  it("saves a shorthand or padded hex as the #RRGGBB it previewed", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);

    for (const [draft, saved] of [
      ["#08E", "#0088EE"],
      [" #8b0000 ", "#8B0000"],
    ] as const) {
      await user.clear(hex);
      await user.type(hex, draft);
      await user.click(saveButton());
      expect(mockUpdateChapter).toHaveBeenLastCalledWith({
        accent_color: saved,
      });
    }
  });

  it("disables Save and says why for a draft that is not a hex code", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);

    for (const draft of ["#8B00", "crimson", "   "]) {
      await user.clear(hex);
      await user.type(hex, draft);
      expect(saveButton()).toBeDisabled();
      expect(hexNeeded()).toHaveClass("text-warning");
      // The reason reaches a screen reader on the control itself.
      expect(saveButton()).toHaveAccessibleDescription(
        /enter a hex code like #5AA9E6/i,
      );
    }

    await user.clear(hex);
    // The hint's own example: following it raises no other warning either.
    await user.type(hex, "#5AA9E6");
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).not.toHaveAccessibleDescription();
    expect(hexNeeded()).toBeNull();
    expect(screen.queryByText(/hard to read on the card/i)).toBeNull();
    expect(screen.queryByText(/under the 4\.5:1 minimum/i)).toBeNull();
  });

  it("disables Save on an empty field and says what to enter, unstyled as a warning", async () => {
    // What a chapter with no stored accent opens to, or a cleared input: the
    // preview shows the fallback gold, so without the hint a disabled Save
    // would look like a colour that can't be saved for no stated reason.
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    await user.clear(screen.getByLabelText(/accent color hex value/i));

    expect(saveButton()).toBeDisabled();
    expect(hexNeeded()).toHaveClass("text-muted-foreground");
    expect(hexNeeded()).not.toHaveClass("text-warning");
  });
});

describe("the accent form surfaces the server's own §8 disclosure (#1183)", () => {
  /*
   * Independent of the draft checks tested above — the preview's contrast as
   * text on the card, computed by `resolveChapterAccentColor`, and its format. This is the real
   * Signet engine's verdict on the colour actually saved, returned by
   * `PATCH /v1/chapters/current` and disclosed rather than corrected: §8
   * forbids a runtime substitution, so a failing save still succeeds.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  async function saveAccent(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);
    await user.clear(hex);
    await user.type(hex, "#222222");
    await user.click(
      screen.getByRole("button", { name: /save accent color/i }),
    );
  }

  it("names the failing role, its ratio, and a next action", async () => {
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [
        { role: "--signet-accent-text", against: "#313131", ratio: 3.21 },
      ],
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await saveAccent(user);

    expect(
      screen.getByText(/accent text on menus and dialogs reads at 3\.2:1/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/under the 4\.5:1 minimum/i)).toBeInTheDocument();
    expect(
      screen.getByText(/try a lighter or darker shade of this hue/i),
    ).toBeInTheDocument();
  });

  it("never prints a failing reported ratio as 4.5:1", async () => {
    // The engine fails a check on the unrounded ratio, so 4.47 is a failure,
    // and rounding printed it as "4.5:1, under the 4.5:1 minimum".
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [
        { role: "--signet-accent-text", against: "#313131", ratio: 4.47 },
      ],
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await saveAccent(user);

    expect(
      screen.getByText(/accent text on menus and dialogs reads at 4\.4:1/i),
    ).toBeInTheDocument();
  });

  it("names the label-on-hover check by the surface it measured", async () => {
    // The engine's fourth text check (#2586): the fill's label on the hover
    // shade it sits on under a pointer. Falling to the raw fallback would print
    // two token names at an officer.
    mockUpdateChapter.mockResolvedValue({
      id: "chap-1",
      failedContrastChecks: [
        {
          role: "--signet-accent-on-primary",
          against: "--signet-accent-hover",
          ratio: 4.21,
        },
      ],
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await saveAccent(user);

    expect(
      screen.getByText(/text on the accent's hover shade reads at 4\.2:1/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/--signet-accent-hover/)).toBeNull();
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
        { role: "--signet-accent-text", against: "#313131", ratio: 3.21 },
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
        { role: "--signet-accent-text", against: "#313131", ratio: 3.21 },
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
      /accent text on menus and dialogs/i,
    ).textContent!;
    expect(warning).toMatch(/reads at 3\.2:1, under the 4\.5:1 minimum\./);
    expect(warning).toMatch(/reads at 2\.5:1, under the 4\.5:1 minimum\./);
  });
});
