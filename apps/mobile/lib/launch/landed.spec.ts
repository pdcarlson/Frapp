import { describe, expect, it } from "vitest";
import { landedScreen } from "./landed";

// Shapes recorded from the Expo web build's navigation container
// (`getRootState()` on each `state` event), 2026-11-18, keys dropped.
const root = (inner: object) => ({
  stale: false,
  index: 0,
  routes: [{ name: "__root", ...inner }],
});

describe("landedScreen (#5449)", () => {
  it("is nothing before the root layout's navigator mounts", () => {
    expect(landedScreen(undefined)).toBeNull();
    expect(landedScreen(root({}))).toBeNull();
  });

  it("is nothing while the auth gate holds and (app) renders no navigator", () => {
    expect(
      landedScreen(
        root({ state: { stale: false, index: 0, routes: [{ name: "(app)" }] } }),
      ),
    ).toBeNull();
  });

  it("is chat home once the tabs mount under (app)", () => {
    const state = root({
      state: {
        index: 0,
        routes: [
          {
            name: "(app)",
            state: {
              index: 0,
              routes: [
                {
                  name: "(tabs)",
                  state: {
                    index: 0,
                    routes: [
                      { name: "index" },
                      { name: "activity" },
                      { name: "messages" },
                      { name: "you" },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    });
    expect(landedScreen(state)).toBe("index");
  });

  it("is the linked screen when a link opens one over the tabs", () => {
    const state = root({
      state: {
        index: 0,
        routes: [
          {
            name: "(app)",
            state: {
              index: 1,
              routes: [
                { name: "(tabs)", state: { index: 0, routes: [{ name: "index" }] } },
                { name: "event-details", params: { id: "x" } },
              ],
            },
          },
        ],
      },
    });
    expect(landedScreen(state)).toBe("event-details");
  });

  it("is sign-in for a signed-out launch", () => {
    const state = root({
      state: {
        index: 0,
        routes: [
          {
            name: "(auth)",
            state: { index: 0, routes: [{ name: "sign-in" }] },
          },
        ],
      },
    });
    expect(landedScreen(state)).toBe("sign-in");
  });
});
