import { act } from "react";
import { create } from "react-test-renderer";
import * as expoRouter from "expo-router";
import { TimeToFullDisplay } from "@sentry/react-native";
import { describe, expect, it } from "vitest";
import { ScreenReady } from "./screen-ready";

// The suite's focus controls (`vitest.setup.ts`).
const focus = expoRouter as unknown as {
  __blur: () => void;
  __refocus: () => void;
};

function lastReady(): unknown {
  const calls = (
    TimeToFullDisplay as unknown as { mock: { calls: unknown[][] } }
  ).mock.calls;
  return (calls.at(-1)?.[0] as { ready?: boolean } | undefined)?.ready;
}

describe("ScreenReady (#4342)", () => {
  it("hands Sentry the screen's ready flag while the screen is focused", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ScreenReady ready={false} />);
    });
    expect(lastReady()).toBe(false);
    act(() => tree.update(<ScreenReady ready />));
    expect(lastReady()).toBe(true);
    act(() => tree.unmount());
  });

  it("records nothing while blurred, so a screen underneath never times the next one", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ScreenReady ready />);
    });
    act(() => focus.__blur());
    expect(lastReady()).toBe(false);
    act(() => focus.__refocus());
    expect(lastReady()).toBe(true);
    act(() => tree.unmount());
  });
});
