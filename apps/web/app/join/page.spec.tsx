import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * #2302. A user who hasn't accepted the current Terms can't join without
 * ticking the box, and one who has isn't asked again. Mobile's
 * `lib/onboarding/join-screen.spec.tsx` pins the same rules.
 */

const { redeemMutate, legal } = vi.hoisted(() => ({
  redeemMutate: vi.fn(),
  legal: { data: { required: false } as { required: boolean } | undefined },
}));

// The Terms checkbox runs the real `useJoinTermsCheckbox` against a mock API
// client (`statusClient`), so this pins the page and the shared rule together.
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRedeemInvite: () => ({ mutateAsync: redeemMutate, isPending: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => Promise.resolve({ id: "auth-1" }),
}));
vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FrappClientProvider } from "@repo/hooks";
import { LEGAL_ACCEPTANCE_REQUIRED_MESSAGE } from "@repo/validation";
import JoinPage from "./page";

/** Answers `GET /v1/users/me/legal-acceptance`; `undefined` never answers. */
const statusClient = {
  GET: () =>
    legal.data === undefined
      ? new Promise(() => {})
      : Promise.resolve({ data: legal.data, error: undefined }),
};

async function renderReady() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <FrappClientProvider
        client={
          statusClient as unknown as ComponentProps<
            typeof FrappClientProvider
          >["client"]
        }
        chapterId={null}
      >
        <JoinPage />
      </FrappClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Invite");
  fireEvent.change(screen.getByLabelText("Invite"), {
    target: { value: "invite-token-1" },
  });
}

describe("web join — the Terms checkbox (#2302)", () => {
  beforeEach(() => {
    redeemMutate.mockReset();
    redeemMutate.mockResolvedValue({ chapterId: "ch-1", memberId: "m-1" });
  });

  it("doesn't ask a user who already accepted the current Terms", async () => {
    legal.data = { required: false };
    await renderReady();
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Join chapter" }));

    await waitFor(() =>
      expect(redeemMutate).toHaveBeenCalledWith({ token: "invite-token-1" }),
    );
  });

  it("asks, and won't join until the box is ticked", async () => {
    legal.data = { required: true };
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Join chapter" }));

    expect(redeemMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Agree to the Terms of Service/)).toBeTruthy();
  });

  it("sends the checkbox once it is ticked", async () => {
    legal.data = { required: true };
    await renderReady();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Join chapter" }));

    await waitFor(() =>
      expect(redeemMutate).toHaveBeenCalledWith({
        token: "invite-token-1",
        accept_terms_privacy: true,
      }),
    );
  });

  it("asks while the status is still unknown", async () => {
    legal.data = undefined;
    await renderReady();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("shows the checkbox when the server refuses a join for want of it", async () => {
    legal.data = { required: false };
    // As served: `AllExceptionsFilter` sends no `code` (#1020).
    redeemMutate.mockRejectedValueOnce({
      statusCode: 403,
      error: "FORBIDDEN",
      message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
      requestId: "req_1",
    });
    await renderReady();
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Join chapter" }));

    await screen.findByRole("checkbox");
  });
});
