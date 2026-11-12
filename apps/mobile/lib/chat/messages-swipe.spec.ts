import { describe, expect, it } from "vitest";
import {
  MESSAGES_SWIPE_ACTIVATE_X,
  MESSAGES_SWIPE_FAIL_Y,
  opensMessages,
} from "./messages-swipe";

describe("the swipe from Chat home to Messages (#3774)", () => {
  it("opens on a long enough slide to the left, or a quick flick", () => {
    expect(opensMessages({ translationX: -90, velocityX: -100 })).toBe(true);
    expect(opensMessages({ translationX: -40, velocityX: -800 })).toBe(true);
  });

  it("does not open on a short slow slide, or any slide to the right", () => {
    expect(opensMessages({ translationX: -40, velocityX: -100 })).toBe(false);
    expect(opensMessages({ translationX: 120, velocityX: 900 })).toBe(false);
    expect(opensMessages({ translationX: 0, velocityX: -900 })).toBe(false);
  });

  it("starts only leftward, and yields to a vertical scroll early", () => {
    expect(MESSAGES_SWIPE_ACTIVATE_X).toBeLessThan(0);
    expect(MESSAGES_SWIPE_FAIL_Y).toBeLessThan(
      Math.abs(MESSAGES_SWIPE_ACTIVATE_X),
    );
  });
});
