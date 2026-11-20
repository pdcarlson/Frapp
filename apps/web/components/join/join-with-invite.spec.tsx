import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/**
 * #5625. `/join` with an invite: the chapter card before any account, one tap
 * that signs in and joins, and a dead link that still says whom to ask.
 */

const h = vi.hoisted(() => ({
  details: {
    data: undefined as unknown,
    error: null as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  chapters: { data: [] as unknown[], isLoading: false, refetch: vi.fn() },
  redeem: vi.fn(),
  record: vi.fn(),
  ask: vi.fn(),
  askPending: false,
  sessionUser: vi.fn(),
  replace: vi.fn(),
  selectChapter: vi.fn(),
  toast: vi.fn(),
  phone: null as "ios" | "android" | null,
  search: new URLSearchParams(),
  auth: {
    signInWithOAuth: vi.fn(),
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
  },
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useInviteDetails: () => h.details,
  useAccessibleChapters: () => h.chapters,
  useRedeemInvite: () => ({ mutateAsync: h.redeem, isPending: false }),
  useAskForNewLink: () => ({ mutateAsync: h.ask, isPending: h.askPending }),
  useInviteFunnel: () => h.record,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, refresh: vi.fn() }),
  useSearchParams: () => h.search,
}));
vi.mock("@/lib/auth/rejected-session", () => ({
  getLiveSessionUser: h.sessionUser,
}));
vi.mock("@/lib/auth/select-chapter", () => ({
  useSelectChapter: () => h.selectChapter,
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: h.toast }),
}));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));
vi.mock("@/lib/use-phone-platform", () => ({
  usePhonePlatform: () => h.phone,
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: h.auth }),
}));
vi.mock("@/lib/sentry/auth-failures", () => ({ reportAuthFailure: vi.fn() }));
vi.mock("@/components/backwork/bulk/use-confirm-drop-bulk-uploads", () => ({
  useConfirmDropBulkUploads: () => ({
    confirmDrop: () => Promise.resolve(true),
    confirmDropDialog: null,
  }),
}));
vi.mock("@/components/auth/signed-in-as", () => ({
  SignedInAs: ({ email }: { email: string | null }) => (
    <p>Signed in as {email}</p>
  ),
}));
vi.mock("@/lib/app-install", () => ({
  useAppInstall: () => ({
    app: { id: "live.frapp.mobile", scheme: "frapp", name: "Frapp" },
    installUrl: "https://apps.apple.com/app/id1",
  }),
  installSource: () => "store",
}));

import { JoinWithInvite } from "./join-with-invite";
import {
  INVITE_VISIT_STORAGE_KEY,
  JOIN_MARK_STORAGE_KEY,
  clearJoinMark,
  rememberJoinMark,
} from "@/lib/auth/join-visit";

const VISIT = "6f1c2a34-9b8d-4e5f-a1b2-c3d4e5f60718";

/** The funnel steps the card recorded, in order (#5663). */
function steps(): unknown[] {
  return h.record.mock.calls.map(([input]) => input);
}

const CHAPTER_ID = "00000000-0000-4000-8000-000000000001";
const LIVE = {
  chapter_name: "Phi Gamma Delta",
  university: "Rensselaer Polytechnic Institute",
  mark_text: "FIJI",
  accent_color: null,
  invited_by: "Paul Carlson",
  role: null,
  expires_at: "2026-11-26T20:00:00.000Z",
  state: "live",
  chapter_id: CHAPTER_ID,
  member_count: 41,
  sent_at: "2026-11-14T12:00:00.000Z", // noon UTC: the same day in every CI time zone
};

function signedIn() {
  h.sessionUser.mockResolvedValue({ id: "auth-1", email: "winston@rpi.edu" });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearJoinMark();
  window.localStorage.removeItem(INVITE_VISIT_STORAGE_KEY);
  vi.spyOn(crypto, "randomUUID").mockReturnValue(VISIT);
  h.details.data = LIVE;
  h.details.error = null;
  h.details.isLoading = false;
  h.details.isError = false;
  h.chapters.data = [];
  h.chapters.isLoading = false;
  h.askPending = false;
  h.phone = null;
  h.search = new URLSearchParams("token=tok-1");
  h.sessionUser.mockResolvedValue(null);
  h.redeem.mockResolvedValue({ chapterId: CHAPTER_ID, memberId: "m-1" });
  h.ask.mockResolvedValue(undefined);
  h.selectChapter.mockResolvedValue(true);
  h.auth.signInWithOAuth.mockResolvedValue({ error: null });
  h.auth.signInWithOtp.mockResolvedValue({ error: null });
  h.auth.verifyOtp.mockResolvedValue({ error: null });
});

describe("the invite card, signed out (#5625)", () => {
  it("names the chapter and its sender before asking for anything", async () => {
    render(<JoinWithInvite token="tok-1" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Phi Gamma Delta" }),
    ).toBeTruthy();
    expect(screen.getByText("You're invited to join")).toBeTruthy();
    expect(
      screen.getByText("Paul Carlson invited you · 41 members"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue with Apple" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue with email" }),
    ).toBeTruthy();
    expect(screen.getByText(/By continuing you agree to the/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("comes back from Apple marked to join, so one tap is sign-in and join", async () => {
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Apple" }),
    );

    await waitFor(() => expect(h.auth.signInWithOAuth).toHaveBeenCalled());
    const { options } = h.auth.signInWithOAuth.mock.calls[0]![0];
    const next = new URL(options.redirectTo).searchParams.get("next");
    expect(next).toBe("/join?token=tok-1&then=join");
    // The browser half of the mark, without which the URL's then=join does
    // nothing when Apple sends them back.
    expect(
      JSON.parse(window.localStorage.getItem(JOIN_MARK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({ token: "tok-1", then: "join" });
  });

  it("signs in with the email's code without leaving, then joins", async () => {
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with email" }),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "winston@rpi.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await screen.findByText("Check your email");
    const { options } = h.auth.signInWithOtp.mock.calls[0]![0];
    expect(new URL(options.emailRedirectTo).searchParams.get("next")).toBe(
      "/join?token=tok-1&then=join",
    );

    signedIn();
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });

    await waitFor(() =>
      expect(h.auth.verifyOtp).toHaveBeenCalledWith({
        email: "winston@rpi.edu",
        token: "123456",
        type: "email",
      }),
    );
    await waitFor(() =>
      expect(h.redeem).toHaveBeenCalledWith({
        token: "tok-1",
        accept_terms_privacy: true,
      }),
    );
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/welcome"));
    expect(h.selectChapter).toHaveBeenCalledWith(CHAPTER_ID);
  });

  it("says so when the code is wrong, and takes another", async () => {
    h.auth.verifyOtp.mockResolvedValue({
      error: {
        message: "Token has expired or is invalid",
        code: "otp_expired",
      },
    });
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with email" }),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "winston@rpi.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    fireEvent.change(await screen.findByLabelText("6-digit code"), {
      target: { value: "000000" },
    });

    expect(await screen.findByText(/That code didn't work/)).toBeTruthy();
    expect(h.redeem).not.toHaveBeenCalled();
  });

  it("puts the app first on a phone, under the same card", async () => {
    h.phone = "ios";
    render(<JoinWithInvite token="tok-1" />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Phi Gamma Delta" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get Frapp" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Join on the web instead" }),
    );
    expect(h.replace).toHaveBeenCalledWith("/join?token=tok-1&web=1");
  });
});

describe("the invite card, signed in (#5625)", () => {
  beforeEach(signedIn);

  it("offers one Join, which carries the Terms the line under it states", async () => {
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Join chapter" }),
    );

    await waitFor(() =>
      expect(h.redeem).toHaveBeenCalledWith({
        token: "tok-1",
        accept_terms_privacy: true,
      }),
    );
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/welcome"));
    expect(screen.getByText(/By joining you agree to the/)).toBeTruthy();
  });

  it("joins by itself, once, when a sign-in from the card comes back", async () => {
    rememberJoinMark("tok-1", "join");
    h.search = new URLSearchParams("token=tok-1&then=join");
    render(<JoinWithInvite token="tok-1" />);

    await waitFor(() => expect(h.redeem).toHaveBeenCalledTimes(1));
    expect(h.replace).toHaveBeenCalledWith("/join?token=tok-1");
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/welcome"));
  });

  it("never joins on a crafted then=join link this browser never started", async () => {
    h.search = new URLSearchParams("token=tok-1&then=join");
    render(<JoinWithInvite token="tok-1" />);

    await screen.findByRole("button", { name: "Join chapter" });
    expect(h.redeem).not.toHaveBeenCalled();
  });

  it("never joins on a mark left for another invite", async () => {
    rememberJoinMark("tok-2", "join");
    h.search = new URLSearchParams("token=tok-1&then=join");
    render(<JoinWithInvite token="tok-1" />);

    await screen.findByRole("button", { name: "Join chapter" });
    expect(h.redeem).not.toHaveBeenCalled();
  });

  it("never joins on a mark older than half an hour", async () => {
    rememberJoinMark("tok-1", "join", Date.now() - 31 * 60 * 1000);
    h.search = new URLSearchParams("token=tok-1&then=join");
    render(<JoinWithInvite token="tok-1" />);

    await screen.findByRole("button", { name: "Join chapter" });
    expect(h.redeem).not.toHaveBeenCalled();
  });

  it("never joins by itself on a plain visit", async () => {
    render(<JoinWithInvite token="tok-1" />);
    await screen.findByRole("button", { name: "Join chapter" });
    expect(h.redeem).not.toHaveBeenCalled();
  });

  it("tells a member they're already in, instead of a Join that would fail", async () => {
    h.chapters.data = [{ chapter_id: CHAPTER_ID }];
    render(<JoinWithInvite token="tok-1" />);

    expect(await screen.findByText("You're already in")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join chapter" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    await waitFor(() =>
      expect(h.selectChapter).toHaveBeenCalledWith(CHAPTER_ID),
    );
  });

  it("opens the chapter for a member who signed in from the card, without redeeming", async () => {
    h.chapters.data = [{ chapter_id: CHAPTER_ID }];
    rememberJoinMark("tok-1", "join");
    h.search = new URLSearchParams("token=tok-1&then=join");
    render(<JoinWithInvite token="tok-1" />);

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/chat"));
    expect(h.redeem).not.toHaveBeenCalled();
  });

  it("opens the chapter when the join finds them already in (another tab joined)", async () => {
    h.redeem.mockRejectedValue({
      statusCode: 409,
      message: "Already a member",
    });
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Join chapter" }),
    );

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/chat"));
  });
});

describe("a dead link (#5625)", () => {
  beforeEach(() => {
    h.details.data = { ...LIVE, state: "expired" };
  });

  it("still names the chapter and sender, and asks them for a new link", async () => {
    signedIn();
    render(<JoinWithInvite token="tok-1" />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "This invite has expired",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Phi Gamma Delta")).toBeTruthy();
    expect(
      screen.getByText("Paul Carlson sent it on Saturday, November 14"),
    ).toBeTruthy();
    expect(
      screen.getByText("Paul gets a notification with your name."),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ask Paul for a new link" }),
      );
    });

    expect(h.ask).toHaveBeenCalledWith("tok-1");
    expect(
      await screen.findByText(/Asked\. Paul got a notification/),
    ).toBeTruthy();
  });

  it("signs in first when signed out, coming back marked to ask", async () => {
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Ask Paul for a new link" }),
    );

    expect(
      screen.getByText("Sign in first, so Paul knows who's asking."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() => expect(h.auth.signInWithOAuth).toHaveBeenCalled());
    const { options } = h.auth.signInWithOAuth.mock.calls[0]![0];
    expect(new URL(options.redirectTo).searchParams.get("next")).toBe(
      "/join?token=tok-1&then=ask",
    );
  });

  it("asks by itself when that sign-in comes back", async () => {
    signedIn();
    rememberJoinMark("tok-1", "ask");
    h.search = new URLSearchParams("token=tok-1&then=ask");
    render(<JoinWithInvite token="tok-1" />);

    await waitFor(() => expect(h.ask).toHaveBeenCalledTimes(1));
    expect(h.redeem).not.toHaveBeenCalled();
  });

  it("offers no Join", async () => {
    signedIn();
    render(<JoinWithInvite token="tok-1" />);
    await screen.findByRole("button", { name: "Ask Paul for a new link" });
    expect(screen.queryByRole("button", { name: "Join chapter" })).toBeNull();
  });
});

describe("the invite card funnel (#5663)", () => {
  it("records the card once, then the way in", async () => {
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() => expect(h.auth.signInWithOAuth).toHaveBeenCalled());
    expect(steps()).toEqual([
      { step: "card-viewed", state: "live", signed_in: false },
      { step: "sign-in-started", method: "google" },
    ]);
  });

  it("records the email code sent and verified", async () => {
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue with email" }),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "winston@rpi.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByText("Check your email");
    signedIn();
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });

    await waitFor(() => expect(h.redeem).toHaveBeenCalled());
    expect(steps()).toEqual(
      expect.arrayContaining([
        { step: "sign-in-started", method: "email" },
        { step: "email-code-sent" },
        { step: "email-code-verified" },
        // Back signed in: the card is seen again, now with an account.
        { step: "card-viewed", state: "live", signed_in: true },
      ]),
    );
  });

  it("records the join once the redeem succeeds, and a password way in", async () => {
    const first = render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(await screen.findByRole("link", { name: "Sign in" }));
    expect(steps()).toContainEqual({
      step: "sign-in-started",
      method: "password",
    });
    first.unmount();

    signedIn();
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Join chapter" }),
    );

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/welcome"));
    expect(steps()).toContainEqual({ step: "joined" });
  });

  it("records a failed join by its class, never its words", async () => {
    signedIn();
    h.redeem.mockRejectedValue({ statusCode: 403, message: "Forbidden" });
    render(<JoinWithInvite token="tok-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Join chapter" }),
    );

    await waitFor(() =>
      expect(steps()).toContainEqual({
        step: "join-failed",
        reason: "forbidden",
      }),
    );
  });

  it("records an ask for a new link, and the dead state it was asked from", async () => {
    signedIn();
    h.details.data = { ...LIVE, state: "used" };
    render(<JoinWithInvite token="tok-1" />);
    const askButton = await screen.findByRole("button", {
      name: "Ask Paul for a new link",
    });
    await act(async () => {
      fireEvent.click(askButton);
    });

    expect(steps()).toEqual([
      { step: "card-viewed", state: "used", signed_in: true },
      { step: "new-link-asked" },
    ]);
  });
});

describe("a link that isn't an invite (#5625)", () => {
  it("says so and takes another link, signed out too", async () => {
    h.details.data = undefined;
    h.details.isError = true;
    h.details.error = { statusCode: 404, message: "Invite not found" };
    render(<JoinWithInvite token="tok-1" />);

    expect(
      await screen.findByText("This invite link doesn't work"),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Have another invite link?"), {
      target: { value: "https://app.frapp.live/join?token=tok-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open invite" }));
    expect(h.replace).toHaveBeenCalledWith("/join?token=tok-2");
  });
});
