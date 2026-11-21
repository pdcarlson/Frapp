import { describe, expect, it } from "vitest";
import {
  LAUNCH_CAP_MS,
  NO_REPORTER_GRACE_MS,
  READY_SETTLE_MS,
  createLaunchGate,
} from "./launch-gate";

/** A clock the spec moves by hand: `advance(ms)` runs whatever falls due. */
function fakeClock() {
  let now = 0;
  const timers = new Set<{ at: number; run: () => void }>();
  return {
    schedule(run: () => void, ms: number) {
      const timer = { at: now + ms, run };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers]
          .filter((timer) => timer.at <= until)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.delete(due);
        now = due.at;
        due.run();
      }
      now = until;
    },
  };
}

function setup() {
  const clock = fakeClock();
  const gate = createLaunchGate({ schedule: clock.schedule });
  return { clock, gate };
}

describe("the launch gate (#5449)", () => {
  it("lifts once the focused screen says its content is here, after a short settle", () => {
    const { clock, gate } = setup();
    const home = {};
    gate.setLanded(true);
    gate.report(home, false);
    clock.advance(1_000);
    expect(gate.lifted()).toBeNull();

    gate.report(home, true);
    clock.advance(READY_SETTLE_MS - 1);
    expect(gate.lifted()).toBeNull();
    clock.advance(1);
    expect(gate.lifted()).toBe("ready");
  });

  it("stays up through chat home's jump into the last channel, and lifts on the channel's rows", () => {
    const { clock, gate } = setup();
    const home = {};
    const channel = {};
    gate.setLanded(true);
    gate.report(home, false);
    // The list answers and reads ready for a frame before the channel opens.
    gate.report(home, true);
    clock.advance(16);
    gate.report(home, null);
    gate.report(channel, false);
    clock.advance(READY_SETTLE_MS * 4);
    expect(gate.lifted()).toBeNull();

    gate.report(channel, true);
    clock.advance(READY_SETTLE_MS);
    expect(gate.lifted()).toBe("ready");
  });

  it("isn't postponed by a ready screen re-rendering", () => {
    const { clock, gate } = setup();
    const home = {};
    gate.report(home, true);
    for (let i = 0; i < 10; i++) {
      clock.advance(READY_SETTLE_MS / 10);
      gate.report(home, true);
    }
    expect(gate.lifted()).toBe("ready");
  });

  it("lifts onto a screen that gives no ready signal once it is drawn", () => {
    const { clock, gate } = setup();
    gate.setLanded(true);
    clock.advance(NO_REPORTER_GRACE_MS - 1);
    expect(gate.lifted()).toBeNull();
    clock.advance(1);
    expect(gate.lifted()).toBe("drawn");
  });

  it("waits for a screen whose ready signal arrives just after it is drawn", () => {
    const { clock, gate } = setup();
    const channel = {};
    gate.setLanded(true);
    clock.advance(NO_REPORTER_GRACE_MS / 2);
    gate.report(channel, false);
    clock.advance(NO_REPORTER_GRACE_MS * 4);
    expect(gate.lifted()).toBeNull();
  });

  it("doesn't count the auth gate's hold, with no screen mounted, as drawn", () => {
    const { clock, gate } = setup();
    gate.setLanded(false);
    clock.advance(LAUNCH_CAP_MS - 1);
    expect(gate.lifted()).toBeNull();
  });

  it("opens with whatever the screen has after about four seconds", () => {
    const { clock, gate } = setup();
    const home = {};
    gate.setLanded(true);
    gate.report(home, false);
    clock.advance(LAUNCH_CAP_MS - 1);
    expect(gate.lifted()).toBeNull();
    clock.advance(1);
    expect(gate.lifted()).toBe("cap");
  });

  it("holds for a notification tap until its screen is open, but never past the cap", () => {
    const { clock, gate } = setup();
    const home = {};
    gate.setLanded(true);
    const release = gate.hold();
    gate.report(home, true);
    clock.advance(1_000);
    expect(gate.lifted()).toBeNull();

    release();
    clock.advance(READY_SETTLE_MS);
    expect(gate.lifted()).toBe("ready");

    const held = setup();
    held.gate.hold();
    held.clock.advance(LAUNCH_CAP_MS);
    expect(held.gate.lifted()).toBe("cap");
  });

  it("lifts at once for the update-required prompt", () => {
    const { gate } = setup();
    gate.lift("now");
    expect(gate.lifted()).toBe("now");
  });

  it("lifts once per process and tells its listeners once", () => {
    const { clock, gate } = setup();
    let heard = 0;
    gate.subscribe(() => {
      heard += 1;
    });
    gate.setLanded(true);
    clock.advance(NO_REPORTER_GRACE_MS);
    expect(gate.lifted()).toBe("drawn");

    // Later screens and a return from the background change nothing.
    const later = {};
    gate.report(later, false);
    gate.hold();
    gate.lift("cap");
    clock.advance(LAUNCH_CAP_MS);
    expect(gate.lifted()).toBe("drawn");
    expect(heard).toBe(1);
  });
});
