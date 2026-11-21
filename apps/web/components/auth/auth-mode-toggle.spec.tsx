import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const { searchParams } = vi.hoisted(() => ({
  searchParams: { suspend: false, value: new URLSearchParams() },
}));

// Suspending here is what the prerendered page does: `useSearchParams` can't
// answer before hydration, so the Suspense boundary draws its fallback.
const neverResolves = new Promise<never>(() => {});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => {
    if (searchParams.suspend) throw neverResolves;
    return searchParams.value;
  },
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: {} }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import SignInPage from "@/app/(auth)/sign-in/page";
import SignUpPage from "@/app/(auth)/sign-up/page";

const PAGES = [
  { name: "/sign-in", Page: SignInPage, current: "Sign in", other: "Create account" },
  { name: "/sign-up", Page: SignUpPage, current: "Create account", other: "Sign in" },
] as const;

function toggle() {
  return screen.getByRole("navigation", { name: "Sign in or create an account" });
}

/**
 * The mode toggle before and after the page can read its search params.
 *
 * Before (#3797): the fallback is the static HTML a visitor from
 * `/join?token=…` sees first, and its toggle used to link to
 * `?redirectTo=/chat`. A click before hydration reached the other mode
 * without the invite, so the new account landed on `/chat`.
 */
describe("auth mode toggle", () => {
  it.each(PAGES)("$name fallback draws the toggle without links", ({ Page, current, other }) => {
    searchParams.suspend = true;
    render(<Page />);

    const nav = toggle();
    expect(within(nav).queryAllByRole("link")).toHaveLength(0);
    expect(within(nav).getByText(current)).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByText(other)).toBeInTheDocument();
  });

  it.each(PAGES)("$name carries the visit's redirectTo once hydrated", ({ Page, other }) => {
    searchParams.suspend = false;
    searchParams.value = new URLSearchParams({ redirectTo: "/join?token=abc" });
    render(<Page />);

    const link = within(toggle()).getByRole("link", { name: other });
    expect(link.getAttribute("href")).toContain(
      `redirectTo=${encodeURIComponent("/join?token=abc")}`,
    );
  });
});
