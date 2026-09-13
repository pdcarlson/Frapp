import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { back, push, captureException } = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push }) }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import tailwindConfig from "@/tailwind.config";
import NotFound from "@/app/not-found";
import RouteError from "@/app/error";

/**
 * Board `1k` and the one constraint the whole component exists to hold:
 * **crest art appears here and nowhere else, and it never retints.**
 *
 * `auth-screen.spec.tsx` already guards the 30/52px mark chip's wrapper span.
 * This guards the other half of the brand surface, which that spec cannot see:
 * the 260px raster on the two terminal-state routes.
 */

const CREST_ASSET = "/brand/signet-emblem-B.png";
const CREST = /signet-emblem-B\.png/;

/** Every class the accent slot can reach. A crest carrying one is the defect. */
const ACCENT_CLASS =
  /\b(bg|text|border|ring|from|to|via)-(primary|accent-subtle|accent-border|accent-text)\b/;

describe("the crest", () => {
  it.each([
    ["404", () => render(<NotFound />)],
    [
      "500",
      () => render(<RouteError error={new Error("x")} retry={vi.fn()} />),
    ],
  ])(
    "is the locked raster on the %s page, and is not paintable",
    (_code, renderPage) => {
      const { container } = renderPage();
      const crest = container.querySelector("img");

      expect(crest).not.toBeNull();
      expect(crest!.getAttribute("src")).toMatch(CREST);

      // `1k`: "Crest is the locked raster at native colors, never recolored."
      // A raster cannot take `--primary`, but a wrapper, a border or a tint
      // utility on the element can, and nothing else in the repo would catch
      // it. So walk up to `<main>` rather than checking the image alone: the
      // concrete regression is someone re-adding the board's dropped
      // `opacity:.9` as `<div className="bg-primary p-1">` around the crest,
      // which would put the mark on a chapter-accent field on the one surface
      // that renders it largest.
      for (
        let el: HTMLElement | null = crest;
        el && el.tagName !== "MAIN";
        el = el.parentElement
      ) {
        expect(
          el.className,
          `${el.tagName} carries an accent class`,
        ).not.toMatch(ACCENT_CLASS);
        expect(el.getAttribute("style") ?? "").not.toMatch(
          /--primary|--accent|filter|opacity/,
        );
      }

      // Decorative: the page says what happened in text, so the crest is a
      // restatement. Same call `signet-mark.tsx` makes.
      expect(crest!.getAttribute("alt")).toBe("");
      expect(crest!.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it("is drawn on the mark's own field, so the tile edge does not show", () => {
    // `--surface-1` is `#1A1A1A`, which since #2153 is the committed raster's
    // field exactly. That equality is what lets the wash the board draws at
    // `opacity:.9` be dropped without the crest reading as a pasted-on square.
    const { container } = render(<NotFound />);
    expect(container.querySelector("main")?.className).toMatch(
      /\bbg-surface-1\b/,
    );
    expect(container.querySelector("img")?.className).not.toMatch(/\bopacity-/);
  });

  it("is the only crest art in apps/web", async () => {
    // `1k` allows crest art in one place, and its note adds "In-app empty
    // states stay crest-free". Matched on the **raster path**, not on
    // `CrestPage`: the rule is about the emblem reaching a surface, and a new
    // empty state rendering `<Image src="/brand/signet-emblem-B.png" />`
    // directly would break it while importing nothing.
    //
    // `signet-mark.tsx` is the one allowed non-terminal site. It is the 30/52px
    // chip `components.md` §7 defines, and `auth-screen.spec.tsx` guards it.
    const { globSync, readFileSync } = await import("node:fs");
    const root = `${__dirname}/../..`;
    const ALLOWED = [
      "components/auth/signet-mark.tsx",
      "components/shared/crest-page.tsx",
    ];
    const painters = globSync("**/*.tsx", { cwd: root })
      .filter((f) => !f.includes("node_modules") && !f.endsWith(".spec.tsx"))
      .filter((f) => readFileSync(`${root}/${f}`, "utf8").includes(CREST_ASSET))
      .filter((f) => !ALLOWED.includes(f));
    expect(painters).toEqual([]);
  });

  it("reaches exactly the two terminal routes", async () => {
    // Matched on the import statement, not the bare word: a docstring that
    // merely mentions `CrestPage` is a cross-reference, not a call site, and
    // failing on one would train the next person to loosen the test.
    const { globSync, readFileSync } = await import("node:fs");
    const root = `${__dirname}/../..`;
    const IMPORTS_CREST = /import\s*\{[^}]*\bCrestPage\b[^}]*\}\s*from/;
    const importers = globSync("**/*.tsx", { cwd: root })
      .filter((f) => !f.includes("node_modules") && !f.endsWith(".spec.tsx"))
      .filter((f) => IMPORTS_CREST.test(readFileSync(`${root}/${f}`, "utf8")));
    expect(importers.sort()).toEqual(["app/error.tsx", "app/not-found.tsx"]);
  });
});

describe("the 404 page", () => {
  it("says what the board says", () => {
    render(<NotFound />);
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing lives here." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The link is old, or points at a chapter you're not in.",
      ),
    ).toBeInTheDocument();
  });

  it("offers a way out that does not depend on history", async () => {
    // "Go back" is `history.back()`, and a pasted stale link opens a fresh tab
    // where that is a silent no-op — the dominant arrival for this page. So the
    // primary is an absolute route, and the secondary falls back to one.
    render(<NotFound />);
    expect(screen.getByRole("link", { name: "Back to chat" })).toHaveAttribute(
      "href",
      "/chat",
    );
  });

  it("falls back to a route when there is no history to go back to", async () => {
    // jsdom starts every test at `history.length === 1`, which is exactly the
    // cold-open case, so this is the default path here.
    back.mockClear();
    push.mockClear();
    render(<NotFound />);
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(back).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("uses real history when there is some", async () => {
    // The other branch, so the guard is pinned in both directions rather than
    // only in the one jsdom happens to produce.
    back.mockClear();
    push.mockClear();
    const length = vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    try {
      render(<NotFound />);
      await userEvent.click(screen.getByRole("button", { name: "Go back" }));
      expect(back).toHaveBeenCalledOnce();
      expect(push).not.toHaveBeenCalled();
    } finally {
      length.mockRestore();
    }
  });
});

describe("the error page", () => {
  it("reports, so adding this boundary does not cut Sentry coverage", () => {
    // Before this file existed, every render error below the root layout
    // bubbled to `global-error.tsx`, which reports. Catching them here without
    // `captureException` would have made the product look better and report
    // less.
    captureException.mockClear();
    const error = new Error("boom");
    render(<RouteError error={error} retry={vi.fn()} />);
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("retries rather than resets", async () => {
    // Next 16 renamed the prop and kept both. `reset()` re-renders the same
    // children without re-fetching, so a Retry button wired to it replays the
    // failed render against the same cache. See the docstring in `error.tsx`.
    const retry = vi.fn();
    render(<RouteError error={new Error("x")} retry={retry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("completes writing.md §3's three parts", () => {
    render(<RouteError error={new Error("x")} retry={vi.fn()} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Something broke on our side.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The error has been reported. Retrying usually clears it.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the type roles it is the first caller of", () => {
  it("are bound, so the classes are not dropped silently", () => {
    // Lane 1 shipped `--text-*` as Tailwind utilities and nothing used them.
    // An unbound key emits no CSS and throws no error — #1145's failure mode —
    // so the three this file reaches are asserted against the config rather
    // than trusted.
    const fontSize = (
      tailwindConfig.theme?.extend as { fontSize?: Record<string, unknown> }
    )?.fontSize;
    expect(Object.keys(fontSize ?? {})).toEqual(
      expect.arrayContaining(["display", "body", "caption"]),
    );
  });
});
