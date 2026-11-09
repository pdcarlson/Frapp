import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * #2302. A user who hasn't accepted the current Terms can't join without
 * ticking the box, and one who has isn't asked again. Mobile's
 * `lib/onboarding/join-screen.spec.tsx` pins the same rules.
 */

const {
  redeemMutate,
  legal,
  pending,
  sessionUser,
  replace,
  selectChapter,
  signOut,
} = vi.hoisted(
  () => ({
    redeemMutate: vi.fn(),
    legal: { data: { required: false } as { required: boolean } | undefined },
    pending: { data: [] as unknown[] | undefined, userIds: [] as unknown[] },
    sessionUser: vi.fn(),
    replace: vi.fn(),
    selectChapter: vi.fn(),
    signOut: vi.fn(),
  }),
);
/** `useAccessibleChapters`' answer; `isLoading` holds the skip decision open. */
const chapters = vi.hoisted(() => ({
  data: [] as unknown[] | undefined,
  isLoading: false,
}));
/** `useMyPermissions`' answer for the active chapter. */
const perms = vi.hoisted(() => ({
  data: { permissions: [] as string[] } as
    | { permissions: string[] }
    | undefined,
}));

// The Terms checkbox runs the real `useJoinTermsCheckbox` against a mock API
// client (`statusClient`), so this pins the page and the shared rule together.
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRedeemInvite: () => ({ mutateAsync: redeemMutate, isPending: false }),
  useAccessibleChapters: () => ({
    data: chapters.data,
    isLoading: chapters.isLoading,
  }),
  useMyPermissions: () => ({ data: perms.data, isLoading: false }),
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
vi.mock("@/lib/auth/session", () => ({
  signOutCurrentSession: signOut,
}));
vi.mock("@/lib/auth/rejected-session", () => ({
  getLiveSessionUser: sessionUser,
}));
vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => selectChapter,
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
  selectChapter.mockReset();
  selectChapter.mockResolvedValue(true);
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  pending.data = [];
  pending.userIds = [];
  chapters.data = [];
  chapters.isLoading = false;
  perms.data = { permissions: [] };
  searchParams.current = new URLSearchParams();
});

describe("web join — a member already in a chapter (#3850)", () => {
  const membership = (id: string, name: string) => ({
    chapter_id: id,
    member_id: `m-${id}`,
    role_ids: ["r-1"],
    has_completed_onboarding: true,
    chapter: { id, name },
  });
  const northfield = membership("ch-north", "Northfield");
  const southfield = membership("ch-south", "Southfield");

  function tree(activeChapterId: string | null) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return (
      <QueryClientProvider client={queryClient}>
        <FrappClientProvider
          client={
            statusClient as unknown as ComponentProps<
              typeof FrappClientProvider
            >["client"]
          }
          chapterId={activeChapterId}
        >
          <JoinPage />
        </FrappClientProvider>
      </QueryClientProvider>
    );
  }

  function renderPage(activeChapterId: string | null = null) {
    legal.data = { required: false };
    return render(tree(activeChapterId));
  }

  beforeEach(() => {
    perms.data = { permissions: ["chat:read"] };
  });

  it("leads with a way back to their chapter and keeps the form for another invite", async () => {
    chapters.data = [northfield];
    renderPage();

    expect(
      await screen.findByText("You're already in Northfield"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open chat" }).getAttribute("href"),
    ).toBe("/chat");
    expect(screen.getByLabelText("Invite")).toBeTruthy();
    expect(replace).not.toHaveBeenCalledWith("/chat");
  });

  it("names the active chapter, not the first one listed", async () => {
    chapters.data = [northfield, southfield];
    renderPage("ch-south");

    expect(
      await screen.findByText("You're already in Southfield"),
    ).toBeTruthy();
  });

  it("offers no Open chat to a member with no role, whom /chat would send to /no-access", async () => {
    chapters.data = [northfield];
    perms.data = { permissions: [] };
    renderPage();

    expect(await screen.findByLabelText("Invite")).toBeTruthy();
    expect(screen.queryByText(/You're already in/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open chat" })).toBeNull();
  });

  it("sends a member who came from the sign-in footer, with no invite, to chat", async () => {
    chapters.data = [northfield];
    searchParams.current = new URLSearchParams("from=sign-in");
    renderPage();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat"));
    expect(screen.queryByLabelText("Invite")).toBeNull();
  });

  it("holds the form back while the membership read is loading on that visit", async () => {
    chapters.data = undefined;
    chapters.isLoading = true;
    searchParams.current = new URLSearchParams("from=sign-in");
    renderPage();

    await waitFor(() => expect(sessionUser).toHaveBeenCalled());
    expect(await screen.findByText("Verifying your session…")).toBeTruthy();
    expect(screen.queryByLabelText("Invite")).toBeNull();
    expect(replace).not.toHaveBeenCalledWith("/chat");
  });

  it("keeps the page when invites were emailed to the account, which is why the footer asked", async () => {
    chapters.data = [northfield];
    pending.data = [
      {
        token: "offer-1",
        chapter_name: "Southfield",
        university: "State",
        mark_text: null,
        accent_color: null,
        invited_by: null,
        role: "member",
      },
    ];
    searchParams.current = new URLSearchParams("from=sign-in");
    renderPage();

    expect(
      await screen.findByRole("button", { name: "Join Southfield" }),
    ).toBeTruthy();
    expect(replace).not.toHaveBeenCalledWith("/chat");
  });

  it("keeps the page when that visit carries an invite, which may be for another chapter", async () => {
    chapters.data = [northfield];
    searchParams.current = new URLSearchParams("from=sign-in&token=abc");
    renderPage();

    expect(await screen.findByLabelText("Invite")).toBeTruthy();
    expect(replace).not.toHaveBeenCalledWith("/chat");
  });

  it("decides once, so a join on this page never triggers the skip mid-redeem", async () => {
    chapters.data = [];
    searchParams.current = new URLSearchParams("from=sign-in");
    const { rerender } = renderPage();
    expect(await screen.findByLabelText("Invite")).toBeTruthy();

    // A redeem refetches the chapter list: the count goes 0 to 1.
    chapters.data = [northfield];
    rerender(tree(null));

    expect(await screen.findByText("You're already in Northfield")).toBeTruthy();
    expect(replace).not.toHaveBeenCalledWith("/chat");
  });

  it("shows the form to an account with no chapter, even from the sign-in footer", async () => {
    chapters.data = [];
    searchParams.current = new URLSearchParams("from=sign-in");
    renderPage();

    expect(await screen.findByLabelText("Invite")).toBeTruthy();
    expect(screen.queryByText(/You're already in/)).toBeNull();
    expect(replace).not.toHaveBeenCalledWith("/chat");
  });
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

  it("signs out and comes back to this invite after signing in again", async () => {
    searchParams.current = new URLSearchParams("token=abc");
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, origin: "http://localhost", assign },
    });
    try {
      renderPage();
      await screen.findByLabelText("Invite");
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith(
          "/sign-in?redirectTo=%2Fjoin%3Ftoken%3Dabc",
        ),
      );
      expect(signOut).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
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

    // The API answers, but the chapter switch is still running.
    let switched: (value: unknown) => void = () => {};
    selectChapter.mockReturnValue(new Promise((resolve) => (switched = resolve)));
    finish({ chapterId: "ch-1", memberId: "m-1" });
    await waitFor(() => expect(selectChapter).toHaveBeenCalledWith("ch-1"));
    fireEvent.click(screen.getByRole("button", { name: "Join Theta Chi Beta" }));
    expect(redeemMutate).toHaveBeenCalledTimes(1);

    // And it stays locked once the navigation to chat has started.
    switched(true);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat"));
    const after = screen.getByRole("button", { name: "Join Theta Chi Beta" });
    expect(after).toHaveProperty("disabled", true);
    fireEvent.click(after);
    expect(redeemMutate).toHaveBeenCalledTimes(1);
  });
});
