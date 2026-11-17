/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { AccessibilityInfo } from "react-native";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useScreenReaderOn } from "./screen-reader";

/**
 * Whether VoiceOver or TalkBack is on, followed live: the tab bar's fold
 * (#4904) must never hide the tabs from a member who turns one on mid-session.
 */
function mount() {
  let seen: boolean | null = null;
  function Probe() {
    seen = useScreenReaderOn();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return () => seen;
}

function listener() {
  const calls = vi.mocked(AccessibilityInfo.addEventListener).mock.calls;
  return calls[calls.length - 1][1] as unknown as (enabled: boolean) => void;
}

describe("useScreenReaderOn", () => {
  it("counts as on until the first read answers, then follows it", async () => {
    const seen = mount();
    expect(seen()).toBe(true);
    await act(async () => {});
    expect(seen()).toBe(false);
  });

  it("follows a screen reader turned on mid-session", async () => {
    const seen = mount();
    await act(async () => {});
    act(() => listener()(true));
    expect(seen()).toBe(true);
    act(() => listener()(false));
    expect(seen()).toBe(false);
  });

  it("keeps a change heard before the first read answers over that read", async () => {
    let answer!: (enabled: boolean) => void;
    vi.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const seen = mount();
    act(() => listener()(true));
    await act(async () => answer(false));
    expect(seen()).toBe(true);
  });
});
