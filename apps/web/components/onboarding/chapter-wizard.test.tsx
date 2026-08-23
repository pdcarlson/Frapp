import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Capture the onboard mutation args. `vi.hoisted` runs before the hoisted
// `vi.mock` factory, so the spies exist when the factory wires them in.
const { onboardMutate, createInviteMutate, activateMutate, refreshSession } =
  vi.hoisted(() => ({
    onboardMutate: vi.fn(),
    createInviteMutate: vi.fn(),
    activateMutate: vi.fn(),
    refreshSession: vi.fn(),
  }));

// useSelectChapter refreshes the Supabase session so the new chapter's
// active_chapter_id claim is issued before the next API call.
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { refreshSession } }),
}));

vi.mock("@repo/hooks", () => ({
  DIRECTORY_MIN_QUERY_LENGTH: 2,
  useAccessibleChapters: () => ({ data: [], isSuccess: true }),
  useChapterDirectorySearch: () => ({
    data: [],
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateInvite: () => ({ mutateAsync: createInviteMutate, isPending: false }),
  useOnboardChapter: () => ({ mutateAsync: onboardMutate, isPending: false }),
  // Consumed by useSelectChapter, which the wizard calls after creating the
  // chapter so the active_chapter_id claim is issued for the new chapter.
  useActivateChapter: () => ({ mutateAsync: activateMutate, isPending: false }),
}));

vi.mock("@repo/org-archetypes", () => ({
  ARCHETYPES: {
    ifc: { key: "ifc", label: "IFC", short: "IFC", council: "Interfraternity" },
  },
  getArchetype: (key: string) => ({ key: key || "ifc" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { setActiveChapterId: (id: string) => void }) => unknown,
  ) => selector({ setActiveChapterId: vi.fn() }),
}));

import { ChapterWizard } from "./chapter-wizard";

/** Drive the wizard from the find step to the identity step via manual entry. */
function gotoIdentityStep() {
  fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Chapter / organization name"), {
    target: { value: "Test Chapter" },
  });
  fireEvent.change(screen.getByLabelText("University"), {
    target: { value: "Test University" },
  });
}

describe("ChapterWizard legal acceptance gate", () => {
  beforeEach(() => {
    onboardMutate.mockReset();
    onboardMutate.mockResolvedValue({ id: "ch-1" });
    createInviteMutate.mockReset();
  });

  it("blocks Create chapter until Terms/Privacy is accepted", () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();

    const createButton = screen.getByRole("button", {
      name: "Create chapter",
    }) as HTMLButtonElement;
    // Identity is valid but the box is unchecked → submission is blocked.
    expect(createButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(createButton.disabled).toBe(false);
  });

  it("links to the Terms, Privacy, and FERPA pages", () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();

    expect(
      screen
        .getByRole("link", { name: "Terms of Service" })
        .getAttribute("href"),
    ).toMatch(/\/terms$/);
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"),
    ).toMatch(/\/privacy$/);
    expect(
      screen.getByRole("link", { name: "FERPA notice" }).getAttribute("href"),
    ).toMatch(/\/ferpa$/);
  });

  it("submits with accept_terms_privacy once accepted", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create chapter" }));

    await waitFor(() => expect(onboardMutate).toHaveBeenCalledTimes(1));
    expect(onboardMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        accept_terms_privacy: true,
        name: "Test Chapter",
        university: "Test University",
      }),
    );
  });
});

describe("the archetype card, at the call site", () => {
  it("paints the selection with the accent pair, never an opacity wash", () => {
    /*
     * `components/profile/profile-contrast.test.ts` measures the tones; it
     * cannot see which one the component reaches for, and a conditional is
     * invisible to a whole-file grep because the *other* branch's classes are
     * in the file either way. So this reads the rendered element.
     *
     * The card shipped `border-primary bg-primary/5` selected and
     * `hover:bg-accent/50` resting. The wash measured 1.005–1.106:1 across all
     * 19 seeds, so the selection it expressed did not render; `--accent` holds
     * `--popover`'s value, so the hover was a colour over itself. This is the
     * same defect the Settings archetype grid had, one slice earlier — that
     * slice fixed one of the two grids.
     */
    render(<ChapterWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));

    const selected = screen.getByRole("radio", { checked: true });
    expect(selected.className).toMatch(/\bbg-accent-subtle-hover\b/);
    expect(selected.className).toMatch(/\bborder-accent-border\b/);
    expect(selected.className).toMatch(/\btext-accent-text\b/);
    // Both Tailwind opacity spellings, and the bare accent slot with them.
    expect(selected.className).not.toMatch(/bg-(?:primary|accent|secondary)\//);
    expect(selected.className).not.toMatch(/(?:^|\s)bg-primary\b/);
    // Anchored to the start of a class rather than a word boundary: the card
    // legitimately carries `focus-visible:border-primary` from `FOCUS_RING`,
    // and that is the indicator the test below pins.
    expect(selected.className).not.toMatch(/(?:^|\s)border-primary\b/);
  });

  it("has a visible focus indicator, which is the border swap and not the ring", () => {
    /*
     * A §6 release-gate failure rather than a repaint nit: the card is a
     * `<button>` that carried `focus-visible:ring-[3px] focus-visible:ring-ring/25`
     * and no border swap. `components/ui/focus.ts` records that "the ring
     * alone does not carry the indicator" — `--ring` at 25% composites to
     * ~1.3:1 — and that the border going solid accent is the half that makes
     * focus visible. Reverting to the ring-only string turns this red.
     */
    render(<ChapterWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));

    for (const card of screen.getAllByRole("radio")) {
      expect(card.className).toMatch(/focus-visible:border-primary/);
    }
  });

  it("draws the council abbreviation on the type scale, not in mono", () => {
    // `font-mono text-[0.65rem]` was 10.4px — off foundations §7's locked
    // scale entirely — on a label rather than a machine value.
    render(<ChapterWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Manual entry" }));

    // The fixture's archetype uses "IFC" for both `short` and `label`, so
    // both spans match; the assertion is over all of them, which is stronger.
    const caps = screen.getAllByText("IFC");
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap.className).not.toMatch(/\bfont-mono\b/);
    }
    expect(caps.some((cap) => /text-\[12\.5px\]/.test(cap.className))).toBe(true);
  });
});

describe("the wizard header", () => {
  it("states the step in words", () => {
    // The old `StepProgress` was four `aria-hidden` bars and no counter, so a
    // screen-reader user in a four-step flow was never told where they were.
    // `meter.ts`'s rule, applied: the bar carries emphasis, the text carries
    // the information.
    render(<ChapterWizard onComplete={() => {}} />);
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Step 1 of 4" }),
    ).toBeInTheDocument();
  });
});
