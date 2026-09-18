import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { chapters, currentChapter, updateOnboarding, route } = vi.hoisted(() => ({
  // Mutable so a test can put the member on a specific route. The tour is
  // mounted in `dashboard-shell.tsx` and is otherwise route-agnostic.
  route: { pathname: "/" },
  chapters: {
    data: [
      {
        chapter_id: "chapter-1",
        has_completed_onboarding: false,
        chapter: { name: "Tau Nu" },
      },
    ] as unknown,
  },
  currentChapter: { data: { name: "Tau Nu" } as unknown },
  updateOnboarding: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: () => chapters,
  useCurrentChapter: () => currentChapter,
  useUpdateOnboarding: () => updateOnboarding,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

import { OnboardingTutorial } from "./onboarding-tutorial";

/**
 * What is pinned here is what the #920 Profile & pre-auth slice changed or
 * could have broken, not the modal's whole surface.
 */
describe("the step strip", () => {
  it("carries no fill, and no opacity wash in either Tailwind spelling", () => {
    // `bg-secondary/60` inside a `DialogContent` composited to 1.050:1 —
    // `--secondary` holds `--card`'s value and a dialog is `--popover`. The
    // class-string guard in `components/profile/family-call-sites.spec.ts`
    // catches the source; this catches the rendered element, which is the half
    // a conditional could hide from a grep.
    render(<OnboardingTutorial />);
    const strip = screen.getByRole("group", { name: /step 1 of 8/i });
    expect(strip.className).not.toMatch(/\bbg-secondary\b/);
    expect(strip.className).not.toMatch(/bg-(?:secondary|card|accent-subtle)\//);
    expect(strip.className).toMatch(/\bborder-border\b/);
  });

  it("states the step in words, not only in bars", () => {
    // `meter.ts`: "the bar is never the only signal … Do not drop that text on
    // the grounds that the bar shows it." The old strip wrapped its bars in
    // `aria-hidden` and printed the count only as `text-xs` beside them; the
    // wizard's version printed nothing at all. The shared recipe makes the
    // counter part of the indicator and names the group with it.
    render(<OnboardingTutorial />);
    expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();
  });
});

describe("the slides", () => {
  it("matches spec/behavior/onboarding.md's eight web screens, in order", async () => {
    // The behavior spec said seven and listed seven; the code has shipped
    // eight since it was written (it adds Points). Behavior spec wins on what
    // the product does, and here the code *is* the product — so the doc moved.
    // This is what keeps the two from drifting apart again.
    const user = userEvent.setup();
    render(<OnboardingTutorial />);

    const titles = [
      "Welcome to Signet",
      "Chat",
      "Events",
      "Backwork",
      "Study hours",
      "Points",
      "Your profile",
      "You're all set",
    ];

    for (const [index, title] of titles.entries()) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByText(`Step ${index + 1} of 8`)).toBeInTheDocument();
      if (index < titles.length - 1) {
        await user.click(screen.getByRole("button", { name: "Next" }));
      }
    }
  });

  it("no longer promises a theme control that does not exist", () => {
    // The profile slide advertised "quiet hours, and theme". The theme select
    // was deleted with this slice — nothing had read `user_settings.theme`
    // since `next-themes` left in the shell slice — so the copy went with it.
    render(<OnboardingTutorial />);
    expect(screen.queryByText(/theme/i)).not.toBeInTheDocument();
  });

  it("says Signet, not Frapp", () => {
    // Prose says Signet; only code identifiers, package names, domains and
    // bundle ids stay `frapp`.
    render(<OnboardingTutorial />);
    expect(screen.queryByText(/frapp/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Welcome to Tau Nu on Signet\./)).toBeInTheDocument();
  });
});

describe("the routes the tour must not cover", () => {
  /**
   * Since #2297 the wizard lands a new founder on `/billing`, and this modal
   * would otherwise open over its "Complete checkout" CTA and end on "Dive
   * into your home dashboard".
   *
   * The mock below sets `has_completed_onboarding: false`, which is the case
   * this guard is really for — an invited member, or a founder replaying the
   * tour from Profile. A wizard-created founder is written with the flag
   * already `true` (`chapter.service.ts`), so the tour never fires for them;
   * do not read these tests as proving the founder's first run.
   */
  it("stays shut on the checkout route", () => {
    route.pathname = "/billing";
    try {
      render(<OnboardingTutorial />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      route.pathname = "/";
    }
  });

  it("still opens everywhere else, so the tour is suppressed and not consumed", () => {
    // The flag is deliberately left untouched on the suppressed route, so the
    // founder does not silently lose the tour by having landed on checkout.
    route.pathname = "/chat";
    try {
      render(<OnboardingTutorial />);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(updateOnboarding.mutateAsync).not.toHaveBeenCalled();
    } finally {
      route.pathname = "/";
    }
  });
});
