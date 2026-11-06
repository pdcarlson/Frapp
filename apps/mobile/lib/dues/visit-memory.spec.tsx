/** @vitest-environment jsdom */
import React, { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, describe, expect, it } from "vitest";
import * as expoRouter from "expo-router";
import { clearProductQueryCache } from "../query-client";
import { forgetDuesMemory, useDuesMemory } from "./visit-memory";

/**
 * Dues' captured payments outlive the screen (it is popped off the stack on
 * back), but never a sign-out, an account swap or a chapter switch.
 */

type Memory = ReturnType<typeof useDuesMemory>;

function mount(chapterId: string) {
  const seen: { memory?: Memory } = {};
  function Probe() {
    const memory = useDuesMemory(chapterId);
    React.useEffect(() => {
      seen.memory = memory;
    });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Probe />);
  });
  return { seen, tree };
}

const { __refocus } = expoRouter as unknown as { __refocus: () => void };

const FALL = { id: "inv-fall", title: "Fall dues" };

beforeEach(() => forgetDuesMemory());

describe("useDuesMemory", () => {
  it("brings a chapter's captured payments back on the next mount", () => {
    const first = mount("ch-a");
    act(() => first.seen.memory!.setPayments([FALL]));
    first.seen.memory!.heldAtLeaveRef.current = [FALL.id];
    first.seen.memory!.remember();
    act(() => first.tree.unmount());

    const again = mount("ch-a");
    expect(again.seen.memory!.payments).toEqual([FALL]);
    expect(again.seen.memory!.heldAtLeaveRef.current).toEqual([FALL.id]);
    // Another chapter's Dues starts empty.
    expect(mount("ch-b").seen.memory!.payments).toEqual([]);
  });

  it("doesn't let a screen mounted across a forget write the payments back", () => {
    // Sign-out clears the cache a commit before Dues unmounts, and its leave
    // still runs: the next member on the phone must not see the payment.
    const first = mount("ch-a");
    act(() => first.seen.memory!.setPayments([FALL]));
    forgetDuesMemory();
    first.seen.memory!.remember();
    act(() => first.tree.unmount());

    expect(mount("ch-a").seen.memory!.payments).toEqual([]);
  });

  it("keeps a capture that lands after the member went back", () => {
    // The payment sheet can finish over a Dues the member already swiped
    // away; the charge still holds the invoice on the next visit.
    const first = mount("ch-a");
    const { setPayments } = first.seen.memory!;
    act(() => first.tree.unmount());
    setPayments([FALL]);

    expect(mount("ch-a").seen.memory!.payments).toEqual([FALL]);
  });

  it("is dropped with the query cache on sign-out", () => {
    const first = mount("ch-a");
    act(() => first.seen.memory!.setPayments([FALL]));
    act(() => first.tree.unmount());
    clearProductQueryCache();

    expect(mount("ch-a").seen.memory!.payments).toEqual([]);
  });

  it("shows a Dues uncovered what the one pushed over it captured", () => {
    // Dues, then a notification opens a second Dues over it. The first one,
    // revealed again, must not write its older list back on its next leave.
    const below = mount("ch-a");
    const above = mount("ch-a");
    act(() => above.seen.memory!.setPayments([FALL]));
    act(() => above.tree.unmount());
    act(() => __refocus());
    expect(below.seen.memory!.payments).toEqual([FALL]);
    below.seen.memory!.remember();
    act(() => below.tree.unmount());

    expect(mount("ch-a").seen.memory!.payments).toEqual([FALL]);
  });
});
