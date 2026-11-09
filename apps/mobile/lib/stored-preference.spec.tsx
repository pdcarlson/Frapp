/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStoredPreference } from "./stored-preference";

type Pick = "a" | "b";

function makePreference() {
  return createStoredPreference<Pick>({
    key: "test.pick",
    parse: (raw) => (raw === "b" ? "b" : "a"),
    fallback: "a",
  });
}

/** A deferred `getItem`, so a spec decides when the stored read lands. */
function deferRead() {
  let land!: (raw: string | null) => void;
  vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
    () =>
      new Promise<string | null>((resolve) => {
        land = resolve;
      }),
  );
  return (raw: string | null) => land(raw);
}

const mounted: ReactTestRenderer[] = [];

function renderValue(pref: ReturnType<typeof makePreference>) {
  const seen: Pick[] = [];
  function Probe() {
    seen.push(pref.use());
    return null;
  }
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Probe />);
  });
  mounted.push(tree);
  return seen;
}

beforeEach(() => {
  vi.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(null);
  vi.mocked(AsyncStorage.setItem).mockClear();
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("createStoredPreference", () => {
  it("reads the stored choice when a screen first subscribes", async () => {
    // Nothing calls hydrate by hand: subscribing is what reads storage, which
    // is how an app restart gets the last pick back.
    const land = deferRead();
    const pref = makePreference();
    const seen = renderValue(pref);
    expect(seen.at(-1)).toBe("a");
    expect(AsyncStorage.getItem).toHaveBeenCalledWith("test.pick");

    await act(async () => {
      land("b");
    });
    expect(seen.at(-1)).toBe("b");
  });

  it("keeps a pick made before the stored read lands", async () => {
    const land = deferRead();
    const pref = makePreference();
    const seen = renderValue(pref);

    act(() => pref.set("b"));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("test.pick", "b");
    // The late read of the old value must not undo the tap.
    await act(async () => {
      land("a");
    });
    expect(seen.at(-1)).toBe("b");
  });

  it("falls back when storage fails", async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error("disk"));
    const pref = makePreference();
    await pref.hydrate();
    expect(renderValue(pref).at(-1)).toBe("a");
  });
});
