/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_NOTES } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { TOUR_DUE_STORAGE_KEY } from "@/lib/onboarding/tour";
import {
  WHATS_NEW_SEEN_STORAGE_KEY,
  releaseNoteId,
  resetWhatsNewBootReadForTests,
} from "@/lib/whats-new";
import { ReleaseNoteCard } from "./release-note-card";
import { WHATS_NEW_OPEN_DELAY_MS, WhatsNewHost } from "./whats-new-host";

const USER = "11111111-1111-4111-8111-111111111111";

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return { ...actual, useCurrentUser: () => ({ data: { id: USER } }) };
});

const storage = vi.mocked(AsyncStorage);
let values: Map<string, string>;
let bootKeys: string[];
// `BottomSheetModal` is a host stand-in (`vitest.setup.ts`), so its ref is
// whatever `createNodeMock` hands back: the spy is the sheet opening.
let present: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  resetWhatsNewBootReadForTests();
  values = new Map();
  bootKeys = [];
  present = vi.fn();
  storage.getItem.mockImplementation(async (key: string) => values.get(key) ?? null);
  storage.setItem.mockImplementation(async (key: string, value: string) => {
    values.set(key, value);
  });
  storage.getAllKeys.mockImplementation(async () => bootKeys);
});

afterEach(() => {
  vi.useRealTimers();
});

const NEWEST = RELEASE_NOTES[0]!;
const NEWEST_ID = releaseNoteId(NEWEST);

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <FrappThemeProvider>
        <WhatsNewHost />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal" ? { present } : {},
      },
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WHATS_NEW_OPEN_DELAY_MS + 10);
  });
  return tree;
}

const shown = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ReleaseNoteCard).map((card) => card.props.note);

describe("WhatsNewHost", () => {
  it("shows the new entry once to a phone that saw an older one, and records it", async () => {
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#old");
    const tree = await mount();
    expect(present).toHaveBeenCalledTimes(1);
    expect(shown(tree)[0]).toEqual(NEWEST);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST_ID);
  });

  it("stays shut once the newest entry is recorded", async () => {
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, NEWEST_ID);
    const tree = await mount();
    expect(present).not.toHaveBeenCalled();
    expect(shown(tree)).toEqual([]);
  });

  it("shows the newest entry to an install from before the marker existed", async () => {
    bootKeys = ["chat:lastSeen:channel-1"];
    const tree = await mount();
    expect(present).toHaveBeenCalledTimes(1);
    expect(shown(tree)).toEqual([NEWEST]);
  });

  it("never shows on a fresh install's first launch, and records the newest", async () => {
    const tree = await mount();
    expect(present).not.toHaveBeenCalled();
    expect(shown(tree)).toEqual([]);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST_ID);
  });

  it("never shows on a launch the first-run tour is due", async () => {
    bootKeys = ["chat:lastSeen:channel-1"];
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#old");
    values.set(TOUR_DUE_STORAGE_KEY, USER);
    const tree = await mount();
    expect(present).not.toHaveBeenCalled();
    expect(shown(tree)).toEqual([]);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST_ID);
  });

  it("records nothing when the sheet never got to open", async () => {
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#old");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <FrappThemeProvider>
          <WhatsNewHost />
        </FrappThemeProvider>,
      );
    });
    // Unmounted before the open delay ran out (a sign-out, say).
    await act(async () => tree.unmount());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WHATS_NEW_OPEN_DELAY_MS + 10);
    });
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe("2000-01-01#old");
  });
});

/**
 * The first-launch rule needs the phone's keys read before any screen can
 * write chat state, so the root layout starts the read at module load.
 * Started later, a fresh install's first chat would read as an old install.
 */
describe("the boot read", () => {
  it("starts at module load in the root layout", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/_layout.tsx"),
      "utf8",
    );
    expect(source).toMatch(/^void startWhatsNewBootRead\(\);$/m);
  });
});
