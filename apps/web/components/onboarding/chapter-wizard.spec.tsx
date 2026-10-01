import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Capture the onboard mutation args. `vi.hoisted` runs before the hoisted
// `vi.mock` factory, so the spies exist when the factory wires them in.
const {
  onboardMutate,
  createInviteMutate,
  emailInvitesMutate,
  activateMutate,
  uploadLogoMutate,
  directoryRows,
  refreshSession,
  routerPush,
  routerReplace,
} = vi.hoisted(() => ({
  onboardMutate: vi.fn(),
  createInviteMutate: vi.fn(),
  emailInvitesMutate: vi.fn(),
  activateMutate: vi.fn(),
  uploadLogoMutate: vi.fn(),
  // What the directory search answers; empty unless a test fills it.
  directoryRows: { current: [] as unknown[] },
  refreshSession: vi.fn(),
  routerPush: vi.fn(),
  // Hoisted like `routerPush` so the wizard's finish destination is
  // assertable. It was a throwaway `vi.fn()` inline in the mock factory, which
  // made the one thing #2297 changes about this component untestable.
  routerReplace: vi.fn(),
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
    data: directoryRows.current,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateInvite: () => ({
    mutateAsync: createInviteMutate,
    isPending: false,
  }),
  useEmailInvites: () => ({
    mutateAsync: emailInvitesMutate,
    isPending: false,
  }),
  useOnboardChapter: () => ({ mutateAsync: onboardMutate, isPending: false }),
  // Consumed by useSelectChapter, which the wizard calls after creating the
  // chapter so the active_chapter_id claim is issued for the new chapter.
  useActivateChapter: () => ({ mutateAsync: activateMutate, isPending: false }),
  useUploadChapterLogo: () => ({
    mutateAsync: uploadLogoMutate,
    isPending: false,
  }),
}));

vi.mock("@repo/org-archetypes", () => ({
  ARCHETYPES: {
    ifc: { key: "ifc", label: "IFC", short: "IFC", council: "Interfraternity" },
  },
  getArchetype: (key: string) => ({ key: key || "ifc" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplace,
    refresh: vi.fn(),
    push: routerPush,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { setActiveChapterId: (id: string) => void }) => unknown,
  ) => selector({ setActiveChapterId: vi.fn() }),
}));

import {
  DEFAULT_CHAPTER_ACCENT,
  normalizeAccentInput,
} from "@repo/hooks/chapter-identity";
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

/** Drive the wizard all the way to the invite step by completing onboarding. */
async function gotoInviteStep() {
  gotoIdentityStep();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Create chapter" }));
  await waitFor(() =>
    expect(screen.getByText("Invite members")).toBeInTheDocument(),
  );
}

describe("ChapterWizard legal acceptance gate", () => {
  beforeEach(() => {
    onboardMutate.mockReset();
    onboardMutate.mockResolvedValue({ id: "ch-1" });
    createInviteMutate.mockReset();
    emailInvitesMutate.mockReset();
    routerPush.mockReset();
    routerReplace.mockReset();
  });

  it("sends an invited member to /join instead of forcing chapter create", () => {
    render(<ChapterWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "I have an invite" }));
    expect(routerPush).toHaveBeenCalledWith("/join");
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

describe("ChapterWizard accent", () => {
  beforeEach(() => {
    onboardMutate.mockReset();
    onboardMutate.mockResolvedValue({ id: "ch-1" });
  });

  async function submittedAccent(): Promise<unknown> {
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create chapter" }));
    await waitFor(() => expect(onboardMutate).toHaveBeenCalledTimes(1));
    return onboardMutate.mock.calls[0]?.[0]?.branding?.colors?.accent;
  }

  it("sends the Signet house seed when the founder leaves the colour alone (#2102)", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();

    expect(await submittedAccent()).toBe(DEFAULT_CHAPTER_ACCENT);
  });

  it("stores a picked colour as the uppercase #RRGGBB mobile stores for the same input (#1642)", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();
    // A native colour input always reports lowercase. Mobile's typed field
    // uppercases, and both now go through one parser, so the two surfaces
    // store the same string for the same colour.
    fireEvent.change(screen.getByLabelText("Accent color"), {
      target: { value: "#8b0000" },
    });

    const accent = await submittedAccent();
    expect(accent).toBe("#8B0000");
    expect(accent).toBe(normalizeAccentInput("#8b0000"));
  });
});

describe("ChapterWizard chapter mark (#2876)", () => {
  beforeEach(() => {
    onboardMutate.mockReset();
    onboardMutate.mockResolvedValue({ id: "ch-1" });
    activateMutate.mockReset();
    uploadLogoMutate.mockReset();
    uploadLogoMutate.mockResolvedValue({});
    // jsdom has no object URLs; the preview only needs a string back.
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });

  function create() {
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create chapter" }));
  }

  it("sends the short name and a Greek-letters opt-out with the chapter", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();
    fireEvent.change(screen.getByLabelText("Greek letters"), {
      target: { value: "ΦΓΔ" },
    });
    fireEvent.change(screen.getByLabelText("Short name (optional)"), {
      target: { value: "FIJI" },
    });
    fireEvent.click(screen.getByRole("switch", { name: /show greek letters/i }));
    create();

    await waitFor(() => expect(onboardMutate).toHaveBeenCalledTimes(1));
    expect(onboardMutate.mock.calls[0]![0].branding).toMatchObject({
      greek_letters: "ΦΓΔ",
      short_name: "FIJI",
      show_greek_letters: false,
    });
  });

  it("previews the mark without the letters once they are turned off", () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();
    fireEvent.change(screen.getByLabelText("Greek letters"), {
      target: { value: "ΦΓΔ" },
    });
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("ΦΓΔ");
    fireEvent.click(screen.getByRole("switch", { name: /show greek letters/i }));
    expect(screen.getByTestId("chapter-mark-text")).toHaveTextContent("TC");
  });

  it("uploads a chosen logo only after the new chapter is active", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();
    const file = new File(["png"], "crest.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Logo (optional)"), {
      target: { files: [file] },
    });
    expect(screen.getByTestId("chapter-mark-logo")).toHaveAttribute(
      "src",
      "blob:preview",
    );
    create();

    await waitFor(() => expect(uploadLogoMutate).toHaveBeenCalledTimes(1));
    expect(uploadLogoMutate).toHaveBeenCalledWith({
      body: file,
      filename: "crest.png",
      contentType: "image/png",
    });
    // The logo routes are chapter-scoped, so the switch has to land first.
    expect(activateMutate.mock.invocationCallOrder[0]).toBeLessThan(
      uploadLogoMutate.mock.invocationCallOrder[0]!,
    );
  });

  it("clears the file input with the queued logo, so the same file can be chosen again", () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();
    const input = screen.getByLabelText("Logo (optional)") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["png"], "crest.png", { type: "image/png" })] },
    });
    const clearValue = vi.spyOn(input, "value", "set");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clearValue).toHaveBeenCalledWith("");
    expect(screen.queryByTestId("chapter-mark-logo")).not.toBeInTheDocument();
  });

  it("still reaches the invite step when the logo upload fails", async () => {
    uploadLogoMutate.mockRejectedValue(new Error("storage down"));
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();
    fireEvent.change(screen.getByLabelText("Logo (optional)"), {
      target: { files: [new File(["png"], "crest.png", { type: "image/png" })] },
    });
    create();

    await waitFor(() =>
      expect(screen.getByText("Invite members")).toBeInTheDocument(),
    );
  });

  it("keeps the opt-out and short name when the founder re-picks a directory row", async () => {
    // The directory autofills Greek letters for every chapter it knows,
    // FIJI's included. Choosing the row again (after going back) must not
    // switch the letters back on or drop the short name.
    directoryRows.current = [
      {
        id: "dir-fiji",
        org_letters: "ΦΓΔ",
        org_name: "Phi Gamma Delta",
        archetype: "ifc",
        chapter_designation: "Tau Nu",
        university: "Rensselaer Polytechnic Institute",
        university_short: "RPI",
        founded_year: 1893,
        default_colors: null,
      },
    ];
    const pickFiji = async () => {
      fireEvent.change(screen.getByLabelText("Search the chapter directory"), {
        target: { value: "Phi Gamma" },
      });
      fireEvent.click(await screen.findByText(/Phi Gamma Delta/));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    };
    try {
      render(<ChapterWizard onComplete={() => {}} />);
      await pickFiji();
      fireEvent.change(screen.getByLabelText("Short name (optional)"), {
        target: { value: "FIJI" },
      });
      fireEvent.click(
        screen.getByRole("switch", { name: /show greek letters/i }),
      );
      fireEvent.click(screen.getByRole("button", { name: /back/i }));
      fireEvent.click(screen.getByRole("button", { name: /back/i }));
      await pickFiji();

      expect(screen.getByLabelText("Greek letters")).toHaveValue("ΦΓΔ");
      expect(screen.getByLabelText("Short name (optional)")).toHaveValue("FIJI");
      expect(
        screen.getByRole("switch", { name: /show greek letters/i }),
      ).toHaveAttribute("aria-checked", "false");
      create();
      await waitFor(() => expect(onboardMutate).toHaveBeenCalledTimes(1));
      expect(onboardMutate.mock.calls[0]![0].branding).toMatchObject({
        greek_letters: "ΦΓΔ",
        short_name: "FIJI",
        show_greek_letters: false,
      });
    } finally {
      directoryRows.current = [];
    }
  });

  it("uploads nothing when no logo was chosen", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();
    create();

    await waitFor(() => expect(onboardMutate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("Invite members")).toBeInTheDocument(),
    );
    expect(uploadLogoMutate).not.toHaveBeenCalled();
  });
});

describe("the archetype card, at the call site", () => {
  it("paints the selection with the accent pair, never an opacity wash", () => {
    /*
     * `components/profile/profile-contrast.spec.ts` measures the tones; it
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
    // Anchored to the start of a class, so a variant-prefixed
    // `…:border-primary` would not trip it. The card's focus border comes from
    // `FOCUS_RING` (`focus-visible:border-accent-text`), pinned by the test
    // below.
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
      expect(card.className).toMatch(/focus-visible:border-accent-text/);
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
    expect(caps.some((cap) => /\btext-caption\b/.test(cap.className))).toBe(
      true,
    );
  });
});

describe("the invite step's bulk-email path (#238)", () => {
  beforeEach(() => {
    onboardMutate.mockReset();
    onboardMutate.mockResolvedValue({ id: "ch-1" });
    emailInvitesMutate.mockReset();
  });

  it("sends one invite per address and reports the sent count", async () => {
    emailInvitesMutate.mockResolvedValue({
      invites: [{ token: "t1" }, { token: "t2" }],
      failed: [],
    });

    render(<ChapterWizard onComplete={() => {}} />);
    await gotoInviteStep();

    fireEvent.change(screen.getByLabelText("Or invite by email"), {
      target: { value: "a@example.com, b@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invites" }));

    await waitFor(() => expect(emailInvitesMutate).toHaveBeenCalledTimes(1));
    expect(emailInvitesMutate).toHaveBeenCalledWith({
      role: "Member",
      emails: ["a@example.com", "b@example.com"],
    });
    await waitFor(() =>
      expect(screen.getByText("Sent 2 invites.")).toBeInTheDocument(),
    );
  });

  it("de-dupes addresses case-insensitively before sending", async () => {
    emailInvitesMutate.mockResolvedValue({
      invites: [{ token: "t1" }],
      failed: [],
    });

    render(<ChapterWizard onComplete={() => {}} />);
    await gotoInviteStep();

    fireEvent.change(screen.getByLabelText("Or invite by email"), {
      target: { value: "Same@Example.com\nsame@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invites" }));

    await waitFor(() => expect(emailInvitesMutate).toHaveBeenCalledTimes(1));
    expect(emailInvitesMutate).toHaveBeenCalledWith({
      role: "Member",
      emails: ["Same@Example.com"],
    });
  });

  it("reports per-address delivery failures without hiding that the tokens were still created", async () => {
    emailInvitesMutate.mockResolvedValue({
      invites: [{ token: "t1" }, { token: "t2" }],
      failed: ["bad@example.com"],
    });

    render(<ChapterWizard onComplete={() => {}} />);
    await gotoInviteStep();

    fireEvent.change(screen.getByLabelText("Or invite by email"), {
      target: { value: "ok@example.com, bad@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invites" }));

    await waitFor(() =>
      expect(
        screen.getByText("1 invite could not be emailed"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("bad@example.com")).toBeInTheDocument();
  });

  it("rejects an invalid address client-side without calling the API", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    await gotoInviteStep();

    fireEvent.change(screen.getByLabelText("Or invite by email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invites" }));

    expect(emailInvitesMutate).not.toHaveBeenCalled();
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

describe("where the wizard leaves a brand-new founder", () => {
  beforeEach(() => {
    onboardMutate.mockReset();
    onboardMutate.mockResolvedValue({ id: "ch-1" });
    createInviteMutate.mockReset();
    emailInvitesMutate.mockReset();
    routerPush.mockReset();
    routerReplace.mockReset();
  });

  /**
   * `ChapterService.create` has no billing dependency, so the chapter this
   * wizard just made is `subscription_status 'incomplete'`: every screen loads
   * and every paid-ops write 403s permanently (#2297). Landing on chat left
   * the founder in exactly that state, which is the Guideline 2.1 finding.
   */
  it("lands on checkout rather than chat, because a fresh chapter is incomplete", async () => {
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create chapter" }));
    await waitFor(() => expect(onboardMutate).toHaveBeenCalledTimes(1));

    fireEvent.click(
      await screen.findByRole("button", { name: /Skip for now|Finish/ }),
    );

    expect(routerReplace).toHaveBeenCalledWith("/billing");
  });

  it("does not send the founder to the chat landing", async () => {
    // Asserted by absence, and separately from the positive case: the bug this
    // closes is *reachability* of the `incomplete` state, so a revert to
    // `/chat?channel=general` has to fail a test rather than only manual QA.
    render(<ChapterWizard onComplete={() => {}} />);
    gotoIdentityStep();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create chapter" }));
    await waitFor(() => expect(onboardMutate).toHaveBeenCalledTimes(1));

    fireEvent.click(
      await screen.findByRole("button", { name: /Skip for now|Finish/ }),
    );

    const destinations = routerReplace.mock.calls.map(([path]) => String(path));
    expect(destinations).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/chat")]),
    );
  });
});
