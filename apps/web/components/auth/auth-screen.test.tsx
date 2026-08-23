import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { replace, refresh, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  searchParams: { value: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => searchParams.value,
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: {} }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import SignInPage from "@/app/sign-in/page";
import SignUpPage from "@/app/sign-up/page";
import NoAccessPage from "@/app/no-access/page";

/**
 * The three pre-auth screens this can render without a session or a chapter.
 *
 * `/` is a server component (it awaits `getSession()`), and `/join` mounts
 * `useRedeemInvite` plus a real session check, so both are covered by
 * `tests/visual/pre-auth-floor.spec.ts` and by
 * `components/profile/family-call-sites.test.ts` instead.
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
  it("is drawn in house gold on the entry screen, never the accent slot", () => {
    // `brand-identity.md` §2: "The mark and logo MUST NOT take the chapter
    // accent — ever." On these routes `--primary` happens to hold the baked
    // default seed, because `useChapterTheme()` mounts inside `DashboardShell`
    // and pre-auth renders outside it — so the two look identical today and
    // would diverge the moment anything mounted the bridge higher.
    const { container } = render(<SignInPage />);
    const mark = container.querySelector(".bg-gold-house");
    expect(mark).not.toBeNull();
    expect(mark!.className).toMatch(/\btext-gold-on-house\b/);
    expect(mark!.getAttribute("aria-hidden")).toBe("true");
    expect(mark!.className).not.toMatch(/\bbg-primary\b/);
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

  it("is omitted on a screen reached from the entry screen", () => {
    // s02 draws no mark. It belongs to the screen a member arrives on.
    const { container } = render(<SignUpPage />);
    expect(container.querySelector(".bg-gold-house")).toBeNull();
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
    expect(
      screen.getByRole("link", { name: "Create an account" }).getAttribute("href"),
    ).toBe("/sign-up?redirectTo=%2Fevents");
    searchParams.value = new URLSearchParams();
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
  it.each(SCREENS)("$name says Signet and nothing about staging", ({ render: renderScreen }) => {
    // These four screens shipped "Frapp staging", "Sign in to manage your
    // chapter in staging", "This milestone enables real staging usage" and
    // "Invite redemption writes directly to the chapter membership table" —
    // to the first screen a member ever sees.
    const { container } = renderScreen();
    expect(container.textContent).not.toMatch(/frapp/i);
    expect(container.textContent).not.toMatch(/staging/i);
    expect(container.textContent).not.toMatch(/milestone/i);
    expect(container.textContent).not.toMatch(/supabase/i);
  });
});
