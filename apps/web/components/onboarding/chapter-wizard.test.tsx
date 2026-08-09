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
