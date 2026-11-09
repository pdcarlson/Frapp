/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_NOTES } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { TOUR_DUE_STORAGE_KEY } from "@/lib/onboarding/tour";
import {
  WHATS_NEW_SEEN_STORAGE_KEY,
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

beforeEach(() => {
  vi.useFakeTimers();
  resetWhatsNewBootReadForTests();
  values = new Map();
  bootKeys = [];
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

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <FrappThemeProvider>
        <WhatsNewHost />
      </FrappThemeProvider>,
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
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01");
    const tree = await mount();
    expect(shown(tree)[0]).toEqual(NEWEST);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST.date);
  });

  it("stays shut once the newest entry is recorded", async () => {
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, NEWEST.date);
    const tree = await mount();
    expect(shown(tree)).toEqual([]);
  });

  it("shows the newest entry to an install from before the marker existed", async () => {
    bootKeys = ["chat:lastSeen:channel-1"];
    const tree = await mount();
    expect(shown(tree)).toEqual([NEWEST]);
  });

  it("never shows on a fresh install's first launch, and records the newest", async () => {
    const tree = await mount();
    expect(shown(tree)).toEqual([]);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST.date);
  });

  it("never shows on a launch the first-run tour is due", async () => {
    bootKeys = ["chat:lastSeen:channel-1"];
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01");
    values.set(TOUR_DUE_STORAGE_KEY, USER);
    const tree = await mount();
    expect(shown(tree)).toEqual([]);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST.date);
  });
});
