import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOUR_EDGE,
  TOUR_GAP,
  TOUR_STOPS,
  clearTourStop,
  coachPosition,
  locateStop,
  nextPresentIndex,
  readTourStop,
  resumeIndex,
  scrimPath,
  tourProgressLabel,
  tourSpot,
  tourStopText,
  tourStops,
  tourStorageKey,
  writeTourStop,
} from "./tour";

const VIEWPORT = { width: 1280, height: 800 };

describe("the stops", () => {
  it("runs channels, display, roles, Chapter, Direct messages, the avatar", () => {
    // `spec/behavior/onboarding.md` § First-run tour (web), Option A (#5080).
    expect(TOUR_STOPS.map((stop) => stop.key)).toEqual([
      "channels",
      "display",
      "roles",
      "chapter",
      "direct",
      "account",
    ]);
  });

  it("leaves Pick your roles out for a member with no role to join", () => {
    expect(tourStops(false).map((stop) => stop.key)).not.toContain("roles");
    expect(tourStops(true)).toHaveLength(6);
  });

  it("names the chapter on the first stop, or says your chapter", () => {
    const first = TOUR_STOPS[0]!.text;
    expect(tourStopText(first, "Tau Nu")).toBe(
      "You're in Tau Nu. These are the chapter's channels. Click one to start talking.",
    );
    expect(tourStopText(first, null)).toMatch(/^You're in your chapter\./);
  });

  it("prints a $ in the chapter's name as written", () => {
    expect(tourStopText("In {chapter}.", "Cash $$ Club $&")).toBe(
      "In Cash $$ Club $&.",
    );
  });

    it("counts like the phone's tour", () => {
    expect(tourProgressLabel(0, 5)).toBe("1 of 5");
  });
});

describe("resuming", () => {
  it("starts at the paused stop", () => {
    const stops = tourStops(false);
    expect(stops[resumeIndex(stops, "direct")]!.key).toBe("direct");
    expect(resumeIndex(stops, null)).toBe(0);
  });

  it("moves on from a roles stop whose roles are gone", () => {
    const stops = tourStops(false);
    expect(stops[resumeIndex(stops, "roles")]!.key).toBe("chapter");
  });

  it("skips stops whose control isn't on screen, either way", () => {
    const stops = tourStops(false);
    const missing = new Set(["display", "chapter"]);
    const present = (stop: { key: string }) => !missing.has(stop.key);
    expect(nextPresentIndex(stops, 1, 1, present)).toBe(3);
    expect(nextPresentIndex(stops, 2, -1, present)).toBe(0);
    expect(nextPresentIndex(stops, 5, 1, present)).toBeNull();
  });
});

describe("the stop kept in the browser", () => {
  const key = tourStorageKey("user-1", "chapter-1");
  afterEach(() => window.localStorage.clear());

  it("is per member and chapter", () => {
    expect(key).not.toBe(tourStorageKey("user-1", "chapter-2"));
    expect(key).not.toBe(tourStorageKey("user-2", "chapter-1"));
  });

  it("round-trips a stop and ignores anything else", () => {
    writeTourStop(key, "chapter");
    expect(readTourStop(key)).toBe("chapter");
    window.localStorage.setItem(key, "welcome");
    expect(readTourStop(key)).toBeNull();
    writeTourStop(key, "direct");
    clearTourStop(key);
    expect(readTourStop(key)).toBeNull();
  });
});

describe("the spot", () => {
  it("pads the control and keeps inside the window", () => {
    expect(tourSpot({ x: 20, y: 20, width: 100, height: 40 }, VIEWPORT)).toEqual(
      { x: 16, y: 16, width: 108, height: 48 },
    );
    const clipped = tourSpot(
      { x: 1200, y: 760, width: 200, height: 100 },
      VIEWPORT,
    )!;
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(clipped.y + clipped.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("is cut to the stop's tallest", () => {
    expect(
      tourSpot({ x: 0, y: 48, width: 240, height: 700 }, VIEWPORT, 320)!.height,
    ).toBe(320);
  });

  it("is null for a hidden control, which skips the stop", () => {
    expect(tourSpot({ x: 0, y: 0, width: 0, height: 0 }, VIEWPORT)).toBeNull();
    expect(
      tourSpot({ x: 0, y: 900, width: 200, height: 40 }, VIEWPORT),
    ).toBeNull();
  });

  it("is lit through: the path cuts the spot out of the dim", () => {
    const d = scrimPath({ x: 10, y: 10, width: 100, height: 50 }, VIEWPORT);
    expect(d.startsWith("M0 0H1280V800H0Z")).toBe(true);
    expect(d).toContain("M20 10");
  });
});

describe("the coach mark", () => {
  const card = { width: 320, height: 160 };

  it("sits right of a spot on the left of the window", () => {
    const spot = { x: 8, y: 60, width: 240, height: 300 };
    expect(coachPosition(spot, card, VIEWPORT)).toEqual({
      left: 248 + TOUR_GAP,
      top: 60,
    });
  });

  it("sits left of a spot at the right edge", () => {
    const spot = { x: 1230, y: 8, width: 40, height: 40 };
    expect(coachPosition(spot, card, VIEWPORT).left).toBe(1230 - TOUR_GAP - 320);
  });

  it("goes under the spot at 390px", () => {
    const narrow = { width: 390, height: 844 };
    const spot = { x: 8, y: 60, width: 374, height: 300 };
    expect(coachPosition(spot, card, narrow)).toEqual({
      left: TOUR_EDGE,
      top: 360 + TOUR_GAP,
    });
  });

  it("stays on screen over a spot that fills the window", () => {
    const spot = { x: 4, y: 4, width: 1272, height: 792 };
    const at = coachPosition(spot, card, VIEWPORT);
    expect(at.top + card.height).toBeLessThanOrEqual(VIEWPORT.height);
    expect(at.left).toBeGreaterThanOrEqual(TOUR_EDGE);
  });
});

describe("finding a stop's control", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function place(element: Element, x: number, y: number, w: number, h: number) {
    element.getBoundingClientRect = () =>
      ({ left: x, top: y, width: w, height: h }) as DOMRect;
  }

  it("prefers the Committees group for Pick your roles, else the list", () => {
    document.body.innerHTML = `
      <div data-channel-list="channels">
        <div id="block"><p id="channel-section:c2">Committees</p>
          <ul aria-labelledby="channel-section:c2"><li>social</li></ul></div>
      </div>`;
    const roles = TOUR_STOPS.find((stop) => stop.key === "roles")!;
    place(document.querySelector("[data-channel-list]")!, 0, 48, 240, 400);
    place(document.getElementById("block")!, 0, 200, 240, 80);
    place(document.querySelector("ul")!, 0, 220, 240, 60);
    expect(locateStop(roles, document, VIEWPORT)!.spot.y).toBe(196);

    document.getElementById("channel-section:c2")!.textContent = "General";
    expect(locateStop(roles, document, VIEWPORT)!.spot.y).toBe(44);
  });

  it("falls back to the menu button below lg, with its own line", () => {
    document.body.innerHTML = `
      <div data-nav-section="chapter"></div>
      <button data-nav-trigger></button>`;
    const chapter = TOUR_STOPS.find((stop) => stop.key === "chapter")!;
    place(document.querySelector("[data-nav-section]")!, 0, 0, 0, 0);
    place(document.querySelector("[data-nav-trigger]")!, 8, 8, 44, 44);
    expect(locateStop(chapter, document, VIEWPORT)!.text).toMatch(
      /in this menu/,
    );
  });
});

describe("the controls the stops point at", () => {
  // A stop whose control is gone is skipped without a sound, so a rename in
  // one of these files would quietly shorten the tour. Each hook is pinned in
  // the file that draws it.
  const WEB = join(__dirname, "..", "..");
  const HOOKS: Array<[string, string]> = [
    ["components/chat/channel-list.tsx", "data-channel-list={kind}"],
    ["components/chat/channel-list.tsx", "channel-section:"],
    ["components/chat/chat-shell.tsx", 'id="chat-timeline"'],
    ["components/chat/chat-shell.tsx", 'aria-label="Back to channels"'],
    ["components/layout/app-nav.tsx", "data-nav-section={section.id}"],
    ["components/layout/protected-nav-item.tsx", "data-nav-item={item.id}"],
    ["components/layout/top-bar.tsx", "data-nav-trigger"],
    ["components/layout/account-menu.tsx", "data-account-menu"],
  ];

  it.each(HOOKS)("%s carries %s", (file, hook) => {
    expect(readFileSync(join(WEB, file), "utf8")).toContain(hook);
  });
});
