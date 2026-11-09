import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replace, refresh, searchParams, signInWithOAuth } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  searchParams: { value: new URLSearchParams() },
  signInWithOAuth: vi.fn(async () => ({ error: null })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => searchParams.value,
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithOAuth } }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import SignInPage from "@/app/(auth)/sign-in/page";
import SignUpPage from "@/app/(auth)/sign-up/page";
import NoAccessPage from "@/app/(auth)/no-access/page";
import { AuthFrame } from "@/components/auth/auth-frame";

/**
 * The three pre-auth screens this can render without a session or a chapter.
 *
 * `/` is a server component (it awaits `getSession()`), and `/join` mounts
 * `useRedeemInvite` plus a real session check, so both are covered by
 * `tests/visual/pre-auth-floor.spec.ts` and by
 * `components/profile/family-call-sites.spec.ts` instead.
 */
const SCREENS = [
  { name: "/sign-in", render: () => render(<SignInPage />) },
  { name: "/sign-up", render: () => render(<SignUpPage />) },
  { name: "/no-access", render: () => render(<NoAccessPage />) },
] as const;

describe("every pre-auth screen has exactly one typographic anchor", () => {
  it.each(SCREENS)("$name", ({ render: renderScreen }) => {
    // §8 item 3: "each screen has exactly one obvious typographic anchor, so
    // hierarchy is checked per screen and not only per component". The four
    // screens this replaced each had an `<h1>` *and* two or three `CardTitle`s
    // competing with it.
    renderScreen();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("the mark", () => {
  it("is drawn once, by the frame, in house gold rather than the accent slot", () => {
    // `brand-identity.md` §2: "The mark and logo MUST NOT take the chapter
    // accent — ever." On these routes `--primary` happens to hold the baked
    // default seed, because `useChapterTheme()` mounts inside `DashboardShell`
    // and pre-auth renders outside it — so the two look identical today and
    // would diverge the moment anything mounted the bridge higher.
    //
    // Since 2026-11-05 the lockup belongs to the signed-out frame, not to a
    // screen, so it heads sign-in and sign-up alike.
    const { container } = render(
      <AuthFrame>
        <SignUpPage />
      </AuthFrame>,
    );
    const marks = container.querySelectorAll(".signet-mark");
    expect(marks).toHaveLength(1);
    const mark = marks[0]!;
    expect(mark.getAttribute("data-field")).toBe("#1A1A1A");
    expect(mark.getAttribute("data-gold")).toBe("#DDB844");
    expect(mark.querySelector("img")?.getAttribute("src")).toContain(
      "signet-emblem-B.png",
    );
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.className).not.toMatch(/\bbg-primary\b/);
  });

  it("leaves the primary button on the accent slot, which is the right call", () => {
    // Stated as an assertion so the rule reads in one direction only. The
    // *mark* may never take a chapter slot; a button may, and here it must —
    // `Button variant="default"` resolves to the baked default seed on these
    // routes, which is s01's gold to within a hair, and painting it
    // `--gold-house` instead would fork the button primitive for five screens.
    const { container } = render(<SignInPage />);
    expect(container.querySelector("button.bg-primary")).not.toBeNull();
  });

  it("is not drawn again by a screen inside the frame", () => {
    const { container } = render(<SignInPage />);
    expect(container.querySelector(".signet-mark")).toBeNull();
  });
});

describe("sign-in and sign-up are one page with different fields", () => {
  it("keeps the frame's one <main> and the form's one <h1> on both", () => {
    for (const Page of [SignInPage, SignUpPage]) {
      const { container, unmount } = render(
        <AuthFrame>
          <Page />
        </AuthFrame>,
      );
      expect(container.querySelectorAll("main")).toHaveLength(1);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      unmount();
    }
  });

  it("offers the invite route from sign-in, where `/` now sends a visitor", () => {
    render(<SignInPage />);
    // Not `/join` itself (#3776): it is gated and would bounce a signed-out
    // visitor straight back here. This form, pointed at `/join`.
    expect(
      screen.getByRole("link", { name: "Join your chapter" }).getAttribute("href"),
    ).toBe("/sign-in?redirectTo=%2Fjoin");
  });

  it("offers a new account the way to join, keeping the invite (#3776)", () => {
    searchParams.value = new URLSearchParams("redirectTo=/join?token=abc");
    try {
      render(<SignInPage />);
      expect(screen.queryByRole("link", { name: "Join your chapter" })).toBeNull();
      expect(
        screen
          .getByRole("link", { name: "Create an account to join" })
          .getAttribute("href"),
      ).toBe("/sign-up?redirectTo=%2Fjoin%3Ftoken%3Dabc");
    } finally {
      searchParams.value = new URLSearchParams();
    }
  });

  it("draws no back link on sign-up; the mode toggle is the way across", () => {
    render(<SignUpPage />);
    expect(screen.queryByRole("link", { name: "Back" })).toBeNull();
    const toggle = screen.getByRole("navigation", {
      name: "Sign in or create an account",
    });
    expect(
      within(toggle).getByRole("link", { name: "Create account" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(within(toggle).getByRole("link", { name: "Sign in" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("the redirect chain survives the rebuild", () => {
  it("carries redirectTo across the sign-in → sign-up hop", () => {
    // `spec/ui/web-dashboard/README.md` §Gating & routing semantics: the value
    // "survives the sign-in ↔ sign-up hop and is reused as the magic-link
    // `emailRedirectTo`". A rebuilt screen that drops it sends a member to
    // `/chat` instead of the deep link they opened.
    searchParams.value = new URLSearchParams("redirectTo=%2Fevents");
    render(<SignInPage />);
    const toggle = screen.getByRole("navigation", {
      name: "Sign in or create an account",
    });
    expect(
      within(toggle).getByRole("link", { name: "Create account" }).getAttribute("href"),
    ).toBe("/sign-up?redirectTo=%2Fevents");
    expect(
      within(toggle).getByRole("link", { name: "Sign in" }).getAttribute("aria-current"),
    ).toBe("page");
    searchParams.value = new URLSearchParams();
  });

  it("keeps the password primary, the providers equal, and the magic link a text link", () => {
    render(<SignInPage />);
    const apple = screen.getByRole("button", { name: "Continue with Apple" });
    const google = screen.getByRole("button", { name: "Continue with Google" });
    const magic = screen.getByRole("button", { name: "Email me a magic link instead" });
    expect(apple.className).toBe(google.className);
    // A text link, not a third full-width button (Paul, 2026-11-05).
    expect(magic.className).not.toMatch(/\bw-full\b/);
    expect(magic.className).toMatch(/\btext-accent-text\b/);
    expect(magic.className).not.toMatch(/\bborder-input\b/);
    // The labels sit inside the fields and still name them.
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("puts Continue before the magic link in tab order", () => {
    render(<SignInPage />);
    const submit = screen.getByRole("button", { name: "Continue" });
    const magic = screen.getByRole("button", { name: "Email me a magic link instead" });
    expect(
      submit.compareDocumentPosition(magic) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("kicks off Apple OAuth toward the callback with redirectTo intact, tagged as a sign-in", async () => {
    // The tag is how `/auth/callback` tells a sign-in that created a new
    // account from a deliberate sign-up (#3786).
    const user = userEvent.setup();
    signInWithOAuth.mockClear();
    searchParams.value = new URLSearchParams("redirectTo=%2Fjoin%3Ftoken%3Dinv-1");
    render(<SignInPage />);
    await user.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: expect.stringMatching(
          /\/auth\/callback\?next=%2Fjoin%3Ftoken%3Dinv-1&intent=sign-in$/,
        ),
        queryParams: undefined,
      },
    });
    searchParams.value = new URLSearchParams();
  });

  it("does not tag the sign-up screen's OAuth, which creates accounts on purpose", async () => {
    const user = userEvent.setup();
    signInWithOAuth.mockClear();
    render(<SignUpPage />);
    await user.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: expect.not.stringContaining("intent="),
        }),
      }),
    );
  });

  it("applies the open-redirect guard rather than trusting the query", () => {
    // `resolveRedirectPath` falls back to `/chat` for anything that does not
    // start with `/` — the same guard `proxy.ts` applies, applied again here.
    searchParams.value = new URLSearchParams("redirectTo=https%3A%2F%2Fevil.example");
    render(<SignUpPage />);
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/sign-in?redirectTo=%2Fchat");
    searchParams.value = new URLSearchParams();
  });
});

describe("the copy is the product's, not the milestone's", () => {
  it.each(SCREENS)("$name never says Signet or anything about staging", ({ render: renderScreen }) => {
    // These four screens shipped "Frapp staging", "Sign in to manage your
    // chapter in staging", "This milestone enables real staging usage" and
    // "Invite redemption writes directly to the chapter membership table" —
    // to the first screen a member ever sees. The product is Frapp (ADR-25),
    // so the retired name is the one banned here.
    const { container } = renderScreen();
    expect(container.textContent).not.toMatch(/signet/i);
    expect(container.textContent).not.toMatch(/staging/i);
    expect(container.textContent).not.toMatch(/milestone/i);
    expect(container.textContent).not.toMatch(/supabase/i);
  });
});
