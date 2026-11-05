import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "@/tests/source-scan";
import {
  compactControlClassName,
  dashboardTableCheckboxClassName,
} from "./table-controls";

const globalsCss = readFileSync(
  join(REPO, "apps", "web", "app", "globals.css"),
  "utf8",
);

/** The declarations of the first rule whose selector is exactly `selector`. */
function declarationsOf(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = globalsCss.match(
    new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"),
  )?.[1];
  if (body === undefined) throw new Error(`globals.css has no ${selector} rule`);
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    out[name!] = value!.replace(/\s+/g, " ").trim();
  }
  return out;
}

/*
 * The row checkbox is a native input, so the browser paints it unless the page
 * opts out. With `accent-primary` alone it painted its own control: a white
 * square per row before `color-scheme: dark`, and a grey one with a light rim
 * after, never the transparent box and hairline `components.md` § Checkbox
 * specifies (#3186). These pin the opt-out and the spec's paint.
 */
describe("dashboardTableCheckboxClassName", () => {
  const tokens = dashboardTableCheckboxClassName.split(/\s+/);

  it("is painted by the .signet-checkbox rule, not the browser", () => {
    expect(tokens).toContain("signet-checkbox");
    // `accent-color` and border utilities reach nothing on a control the
    // browser draws, so seeing them here means the box went native again.
    expect(tokens).not.toContain("accent-primary");
  });

  it("keeps the spec's box sizes and the shared focus ring", () => {
    expect(tokens).toEqual(
      expect.arrayContaining([
        "h-5",
        "w-5",
        "rounded-[6px]",
        "pointer-coarse:h-6",
        "pointer-coarse:w-6",
        "pointer-coarse:rounded-[7px]",
        "focus-visible:ring-[3px]",
      ]),
    );
  });
});

describe(".signet-checkbox in app/globals.css", () => {
  it("opts out of the browser's control and draws the unchecked box", () => {
    expect(declarationsOf(".signet-checkbox")).toMatchObject({
      appearance: "none",
      border: "1.5px solid rgba(255, 255, 255, 0.25)",
      "background-color": "transparent",
    });
  });

  it("fills with accent-9 when checked, with the check in its ink", () => {
    expect(declarationsOf(".signet-checkbox:checked")).toMatchObject({
      "background-color": "var(--primary)",
      "border-color": "var(--primary)",
    });
    const glyph = declarationsOf(".signet-checkbox::before");
    expect(glyph["background-color"]).toBe("var(--primary-foreground)");
    expect(glyph.mask).toContain("stroke-width='2.2'");
    expect(glyph.mask).toContain("stroke-linecap='round'");
  });

  it("sits below the utilities, so the focus ring's border still applies", () => {
    expect(globalsCss).toMatch(/@layer components\s*\{\s*\.signet-checkbox\s*\{/);
  });
});

/*
 * `compactControlClassName` is 32px to a pointer and must stay 44px to a
 * finger (`components.md` §2's touch floor). Chat's chrome and the dense list
 * rows both use it, so shortening it drops every one of those targets at once,
 * and no type sees a class string change.
 */
describe("compactControlClassName", () => {
  const tokens = compactControlClassName.split(/\s+/);

  it("restores the 44px touch target on a coarse pointer", () => {
    expect(tokens).toEqual(
      expect.arrayContaining(["pointer-coarse:h-11", "pointer-coarse:w-11"]),
    );
  });

  it("is a 32px box to a fine pointer", () => {
    expect(tokens).toEqual(expect.arrayContaining(["h-8", "w-8"]));
  });
});
