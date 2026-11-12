/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one AI switch on the phone is the server's (`AI_ENABLED`): with it off
 * `useAiConsent` reads `null` and no AI entry is drawn, so the app behaves as
 * it did before any of this. Nothing shows on a guess while a read is out.
 */
const state = vi.hoisted(() => ({
  consent: { data: undefined as unknown, isError: false },
  settings: {
    data: undefined as unknown,
    isPending: true,
  },
  settingsEnabled: undefined as boolean | undefined,
  permissions: { data: undefined as unknown, isPending: true },
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => state.consent,
  useAiChapterSettings: (options: { enabled: boolean }) => {
    state.settingsEnabled = options.enabled;
    return state.settings;
  },
  useMyPermissions: () => state.permissions,
}));

import { useAiSurfaces, type AiSurfaces } from "./availability";

function read(): AiSurfaces {
  let value!: AiSurfaces;
  function Probe() {
    value = useAiSurfaces();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return value;
}

const CONSENT = { answer: null, sheet: { version: 2 } };

beforeEach(() => {
  state.consent = { data: CONSENT, isError: false };
  state.settings = {
    data: { ask: true, meeting_notes: true },
    isPending: false,
  };
  state.permissions = {
    data: { permissions: ["ai:use"] },
    isPending: false,
  };
});

describe("useAiSurfaces", () => {
  it("offers nothing, and asks nothing more, where the server has no AI", () => {
    state.consent = { data: null, isError: false };
    expect(read()).toEqual({
      available: false,
      ask: false,
      meetingNotes: false,
      ready: true,
    });
    expect(state.settingsEnabled).toBe(false);
  });

  it("offers nothing until the server has answered", () => {
    state.consent = { data: undefined, isError: false };
    const surfaces = read();
    expect(surfaces).toMatchObject({ ask: false, meetingNotes: false });
    expect(surfaces.ready).toBe(false);

    state.consent = { data: CONSENT, isError: false };
    state.settings = { data: undefined, isPending: true };
    expect(read()).toMatchObject({ ask: false, ready: false });
  });

  it("settles as no Ask when the consent read fails", () => {
    state.consent = { data: undefined, isError: true };
    expect(read()).toMatchObject({ ask: false, ready: true });
  });

  it("follows the president's switch for each feature", () => {
    state.settings = {
      data: { ask: false, meeting_notes: true },
      isPending: false,
    };
    expect(read()).toMatchObject({
      available: true,
      ask: false,
      meetingNotes: true,
      ready: true,
    });
  });

  it("offers nothing to a member whose role can't use AI", () => {
    state.permissions = { data: { permissions: [] }, isPending: false };
    expect(read()).toMatchObject({
      available: true,
      ask: false,
      meetingNotes: false,
    });
  });

  it("doesn't need the member's own yes: the sheet is asked at first use", () => {
    expect(read()).toMatchObject({ ask: true, meetingNotes: true });
  });
});
