/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_NOTES, releaseNoteVersion } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { TOUR_DUE_STORAGE_KEY } from "@/lib/onboarding/tour";
import {
  WHATS_NEW_QUIET_STORAGE_KEY,
  WHATS_NEW_SEEN_STORAGE_KEY,
  resetWhatsNewBootReadForTests,
  resetWhatsNewQuietForTests,
} from "@/lib/whats-new";
import { ReleaseNoteCard } from "./release-note-card";
import { WHATS_NEW_OPEN_DELAY_MS, WhatsNewHost } from "./whats-new-host";

const USER = "11111111-1111-4111-8111-111111111111";

const account = vi.hoisted(() => ({
  state: { settled: true, seen: null } as {
    settled: boolean;
    seen: string | null | undefined;
  },
  record: vi.fn(),
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useCurrentUser: () => ({ data: { id: USER } }),
    useAccountWhatsNewSeen: () => account.state,
    useRecordWhatsNewSeen: () => ({ mutate: account.record }),
  };
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
  resetWhatsNewQuietForTests();
  account.state = { settled: true, seen: null };
  account.record.mockReset();
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
const NEWEST_ID = releaseNoteVersion(NEWEST);

async function mount({ sheet = true } = {}): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <FrappThemeProvider>
        <WhatsNewHost />
      </FrappThemeProvider>,
      {
        // With `sheet: false` the modal's ref stays null: a sheet that never
        // got to present.
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? sheet
              ? { present }
              : null
            : {},
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
  it("shows the new entry once to a phone that saw an older one, and records it once presented", async () => {
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
    // The marker is still the old one when the sheet is asked to present.
    present.mockImplementation(() => {
      expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe("2000-01-01#1");
    });
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
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
    values.set(TOUR_DUE_STORAGE_KEY, USER);
    const tree = await mount();
    expect(present).not.toHaveBeenCalled();
    expect(shown(tree)).toEqual([]);
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST_ID);
  });

  it("records nothing when the sheet never got to open", async () => {
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
    await mount({ sheet: false });
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe("2000-01-01#1");
  });

  it("records nothing when unmounted before the open delay ran out", async () => {
    values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <FrappThemeProvider>
          <WhatsNewHost />
        </FrappThemeProvider>,
      );
    });
    // A sign-out, say.
    await act(async () => tree.unmount());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WHATS_NEW_OPEN_DELAY_MS + 10);
    });
    expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe("2000-01-01#1");
  });

  describe("across devices (#4043)", () => {
    it("tells the account when the sheet opens", async () => {
      values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
      await mount();
      expect(present).toHaveBeenCalledTimes(1);
      expect(account.record).toHaveBeenCalledWith(NEWEST_ID);
    });

    it("doesn't open what another device already showed: it records it and marks Settings", async () => {
      values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
      account.state = { settled: true, seen: NEWEST_ID };
      const tree = await mount();
      expect(present).not.toHaveBeenCalled();
      expect(shown(tree)).toEqual([]);
      expect(values.get(WHATS_NEW_SEEN_STORAGE_KEY)).toBe(NEWEST_ID);
      expect(values.get(WHATS_NEW_QUIET_STORAGE_KEY)).toBe(NEWEST_ID);
      expect(account.record).not.toHaveBeenCalled();
    });

    it("still opens when the account saw only an older entry", async () => {
      values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
      account.state = { settled: true, seen: "2000-01-02#1" };
      await mount();
      expect(present).toHaveBeenCalledTimes(1);
    });

    it("waits for the account, then goes by the phone's marker when it can't be read", async () => {
      values.set(WHATS_NEW_SEEN_STORAGE_KEY, "2000-01-01#1");
      account.state = { settled: false, seen: undefined };
      const tree = await mount();
      expect(present).not.toHaveBeenCalled();

      account.state = { settled: true, seen: undefined };
      await act(async () => {
        tree.update(
          <FrappThemeProvider>
            <WhatsNewHost />
          </FrappThemeProvider>,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WHATS_NEW_OPEN_DELAY_MS + 10);
      });
      expect(present).toHaveBeenCalledTimes(1);
    });

    it("keeps a fresh install's first launch quiet, with no mark", async () => {
      account.state = { settled: true, seen: NEWEST_ID };
      await mount();
      expect(present).not.toHaveBeenCalled();
      expect(values.get(WHATS_NEW_QUIET_STORAGE_KEY)).toBeUndefined();
    });
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
