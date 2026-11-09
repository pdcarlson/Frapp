import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * #2302. A user who hasn't accepted the current Terms can't join without
 * ticking the box, and one who has isn't asked again. Mobile's
 * `lib/onboarding/join-screen.spec.tsx` pins the same rules.
 */

const { redeemMutate, legal, pending, sessionUser, replace } = vi.hoisted(
  () => ({
    redeemMutate: vi.fn(),
    legal: { data: { required: false } as { required: boolean } | undefined },
    pending: { data: [] as unknown[] | undefined, userIds: [] as unknown[] },
    sessionUser: vi.fn(),
    replace: vi.fn(),
  }),
);

// The Terms checkbox runs the real `useJoinTermsCheckbox` against a mock API
// client (`statusClient`), so this pins the page and the shared rule together.
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRedeemInvite: () => ({ mutateAsync: redeemMutate, isPending: false }),
  usePendingInvites: (userId: string | null) => {
    pending.userIds.push(userId);
    return { data: userId ? pending.data : undefined };
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
  useSearchParams: () => searchParams.current,
}));
const searchParams = vi.hoisted(() => ({
  current: new URLSearchParams(),
}));
vi.mock("@/lib/auth/rejected-session", () => ({
  getLiveSessionUser: sessionUser,
}));
vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
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

beforeEach(() => {
  sessionUser.mockReset();
  sessionUser.mockResolvedValue({ id: "auth-1", email: "brother@school.edu" });
  replace.mockReset();
  pending.data = [];
  pending.userIds = [];
  searchParams.current = new URLSearchParams();
});

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
    // No `code`, as an API older than #1020 sends it: the message fallback.
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
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
}

const OFFER = {
  chapter_name: "Sigma Chi Alpha",
  university: "State University",
  mark_text: "SXA",
  accent_color: null,
  invited_by: "Paul Carlson",
  role: "Member",
  expires_at: "2026-11-10T00:00:00.000Z",
  token: "emailed-token",
};

describe("web join — signed out (#3776)", () => {
  it("sends a visitor with no live session to sign in, keeping the invite", async () => {
    sessionUser.mockResolvedValue(null);
    searchParams.current = new URLSearchParams("token=abc");
    window.history.replaceState(null, "", "/join?token=abc");
    renderPage();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/sign-in?redirectTo=%2Fjoin%3Ftoken%3Dabc",
      ),
    );
    window.history.replaceState(null, "", "/");
  });

  it("offers a retry, not a bounce, when Auth can't be asked", async () => {
    sessionUser.mockRejectedValue(new Error("fetch failed"));
    renderPage();
    await screen.findByText("Couldn't check your session");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("web join — invites for the verified address (#3776)", () => {
  beforeEach(() => {
    legal.data = { required: false };
    redeemMutate.mockReset();
    redeemMutate.mockResolvedValue({ chapterId: "ch-1", memberId: "m-1" });
  });

  it("asks for them only once signed in, as this account", async () => {
    renderPage();
    await screen.findByLabelText("Invite");
    expect(pending.userIds[0]).toBeNull();
    expect(pending.userIds.at(-1)).toBe("auth-1");
  });

  it("offers a pending invite with a one-tap Join that redeems its token", async () => {
    pending.data = [OFFER];
    renderPage();
    await screen.findByText("You've been invited to Sigma Chi Alpha");
    expect(
      screen.getByText("State University · from Paul Carlson · Member"),
    ).toBeTruthy();
    // The Terms status is read first; until then the box is asked for.
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Join Sigma Chi Alpha" }));

    await waitFor(() =>
      expect(redeemMutate).toHaveBeenCalledWith({ token: "emailed-token" }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat"));
  });

  it("asks for the Terms before an offered Join, too", async () => {
    legal.data = { required: true };
    pending.data = [OFFER];
    renderPage();
    await screen.findByText("You've been invited to Sigma Chi Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Join Sigma Chi Alpha" }));

    await screen.findByRole("alert");
    expect(redeemMutate).not.toHaveBeenCalled();
  });

  it("shows only the invite a link brought", async () => {
    pending.data = [OFFER];
    searchParams.current = new URLSearchParams("token=link-token");
    renderPage();
    await screen.findByLabelText("Invite");
    expect(screen.queryByText(/You've been invited to/)).toBeNull();
  });

  it("offers nothing when none is pending, and the form is the primary", async () => {
    renderPage();
    await screen.findByLabelText("Invite");
    expect(screen.queryByRole("region", { name: "Your invites" })).toBeNull();
  });
});

describe("web join — who is signed in (#3776)", () => {
  it("names the account and offers Sign out", async () => {
    renderPage();
    await screen.findByLabelText("Invite");
    expect(screen.getByText("brother@school.edu")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("web join — one join at a time (#3776)", () => {
  beforeEach(() => {
    legal.data = { required: false };
    redeemMutate.mockReset();
  });

  it("keeps every Join off until the first join has finished, not just its API call", async () => {
    pending.data = [
      OFFER,
      { ...OFFER, chapter_name: "Theta Chi Beta", token: "second-token" },
    ];
    let finish: (value: unknown) => void = () => {};
    redeemMutate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await screen.findByText("You've been invited to Theta Chi Beta");
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Join Sigma Chi Alpha" }));
    await waitFor(() => expect(redeemMutate).toHaveBeenCalledTimes(1));
    const second = screen.getByRole("button", { name: "Join Theta Chi Beta" });
    expect(second).toHaveProperty("disabled", true);
    fireEvent.click(second);
    expect(redeemMutate).toHaveBeenCalledTimes(1);

    finish({ chapterId: "ch-1", memberId: "m-1" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat"));
    expect(redeemMutate).toHaveBeenCalledTimes(1);
  });
});
