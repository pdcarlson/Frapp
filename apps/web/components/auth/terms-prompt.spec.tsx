import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LEGAL_ACCEPTANCE_LABEL, TERMS_PROMPT_COPY } from "@repo/validation";

/**
 * #2302. A member who hasn't accepted the Terms the server enforces is asked
 * over every dashboard route, and a failed read never locks anyone out.
 */

const { acceptMutate, deleteMutate, signOut, state } = vi.hoisted(() => ({
  acceptMutate: vi.fn(),
  deleteMutate: vi.fn(),
  signOut: vi.fn(),
  state: {
    chapters: { data: [{ chapter_id: "ch-1" }], isSuccess: true } as {
      data: unknown;
      isSuccess: boolean;
    },
    legal: { data: { required: true } } as { data: unknown },
  },
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAccessibleChapters: () => state.chapters,
  useLegalAcceptance: () => state.legal,
  useAcceptLegalTerms: () => ({
    mutateAsync: acceptMutate,
    isPending: false,
    isSuccess: false,
  }),
  useDeleteAccount: () => ({ mutateAsync: deleteMutate }),
}));

vi.mock("@/lib/auth/session", () => ({
  signOutCurrentSession: () => signOut(),
}));

import {
  TERMS_PROMPT_DELETE_FAILED,
  TERMS_PROMPT_SIGN_OUT_FAILED,
  TermsPromptGate,
} from "./terms-prompt";

describe("TermsPromptGate", () => {
  beforeEach(() => {
    acceptMutate.mockReset();
    acceptMutate.mockResolvedValue({ required: false });
    deleteMutate.mockReset();
    signOut.mockReset();
    state.chapters = { data: [{ chapter_id: "ch-1" }], isSuccess: true };
    state.legal = { data: { required: true } };
  });

  it("asks a member who hasn't accepted the current Terms", () => {
    render(<TermsPromptGate />);
    expect(
      screen.getByRole("heading", { name: TERMS_PROMPT_COPY.title }),
    ).toBeTruthy();
  });

  it("keeps asking when a chapters refetch fails but memberships are cached", () => {
    // TanStack after a failed background refetch: status 'error', data kept.
    state.chapters = { data: [{ chapter_id: "ch-1" }], isSuccess: false };
    render(<TermsPromptGate />);
    expect(
      screen.getByRole("heading", { name: TERMS_PROMPT_COPY.title }),
    ).toBeTruthy();
  });

  it("asks nothing of a member who accepted", () => {
    state.legal = { data: { required: false } };
    const { container } = render(<TermsPromptGate />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves a user with no chapter to the wizard", () => {
    state.chapters = { data: [], isSuccess: true };
    render(<TermsPromptGate />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks nothing while the status is unknown or failed", () => {
    state.legal = { data: undefined };
    render(<TermsPromptGate />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the owner-approved wording, with both documents linked", () => {
    render(<TermsPromptGate />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.closest("div")?.textContent).toBe(LEGAL_ACCEPTANCE_LABEL);
    expect(
      screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href"),
    ).toMatch(/\/terms$/);
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"),
    ).toMatch(/\/privacy$/);
  });

  it("records nothing until the box is ticked", () => {
    render(<TermsPromptGate />);
    fireEvent.click(screen.getByRole("button", { name: TERMS_PROMPT_COPY.cta }));
    expect(acceptMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      TERMS_PROMPT_COPY.unticked,
    );
  });

  it("records the acceptance once the box is ticked", async () => {
    render(<TermsPromptGate />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: TERMS_PROMPT_COPY.cta }));
    await waitFor(() => expect(acceptMutate).toHaveBeenCalledTimes(1));
  });

  it("says so when the acceptance couldn't be saved", async () => {
    acceptMutate.mockRejectedValueOnce({ statusCode: 500 });
    render(<TermsPromptGate />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: TERMS_PROMPT_COPY.cta }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Couldn't save your agreement",
      ),
    );
  });

  it("lets a member who declines sign out rather than be trapped", async () => {
    signOut.mockResolvedValue(undefined);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<TermsPromptGate />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"));
    expect(signOut).toHaveBeenCalledTimes(1);
    // Still locked while the page navigates away, rather than re-enabled.
    expect(
      (screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    vi.unstubAllGlobals();
  });

  it("says so, and gives the controls back, when sign-out fails", async () => {
    signOut.mockRejectedValueOnce(new Error("network"));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<TermsPromptGate />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        TERMS_PROMPT_SIGN_OUT_FAILED,
      ),
    );
    expect(assign).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    vi.unstubAllGlobals();
  });

  it("lets a member who declines delete their account, since the prompt covers /profile", async () => {
    deleteMutate.mockResolvedValue(undefined);
    signOut.mockResolvedValue(undefined);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<TermsPromptGate />);
    fireEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"));
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(acceptMutate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("says so, and gives the controls back, when deletion fails", async () => {
    deleteMutate.mockRejectedValueOnce(new Error("network"));
    render(<TermsPromptGate />);
    fireEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        TERMS_PROMPT_DELETE_FAILED,
      ),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Delete account…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
