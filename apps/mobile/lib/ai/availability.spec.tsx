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
  actEnabled: undefined as boolean | undefined,
  actions: undefined as unknown,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => state.consent,
  useAiChapterSettings: (options: { enabled: boolean }) => {
    state.settingsEnabled = options.enabled;
    return state.settings;
  },
  useMyPermissions: () => state.permissions,
  useActStatus: (options: { enabled: boolean }) => {
    state.actEnabled = options.enabled;
    return { data: options.enabled ? state.actions : undefined };
  },
}));

import {
  useActActions,
  useAiSurfaces,
  type AiSurfaces,
} from "./availability";

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

function readActions(enabled?: boolean): readonly string[] {
  let value!: readonly string[];
  function Probe() {
    value = useActActions(enabled === undefined ? undefined : { enabled });
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
    data: { permissions: ["ai:use", "ai:act"] },
    isPending: false,
  };
  state.actions = ["points", "task"];
});

describe("useAiSurfaces", () => {
  it("offers nothing, and asks nothing more, where the server has no AI", () => {
    state.consent = { data: null, isError: false };
    expect(read()).toEqual({
      available: false,
      ask: false,
      catchUp: false,
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

  it("keeps Ask from a member whose role can't use AI, but not drafting, which the server gates on `meetings:record`", () => {
    state.permissions = { data: { permissions: [] }, isPending: false };
    expect(read()).toMatchObject({
      available: true,
      ask: false,
      meetingNotes: true,
    });
  });

  it("doesn't need the member's own yes: the sheet is asked at first use", () => {
    expect(read()).toMatchObject({ ask: true, meetingNotes: true });
  });

  it("offers Catch me up only where Ask is on and chat is a source", () => {
    expect(read().catchUp).toBe(false);
    state.settings = {
      data: { ask: true, meeting_notes: true, chat_source: true },
      isPending: false,
    };
    expect(read().catchUp).toBe(true);
    state.settings = {
      data: { ask: false, meeting_notes: true, chat_source: true },
      isPending: false,
    };
    expect(read().catchUp).toBe(false);
  });

  it("keeps Catch me up from a member whose role can't use AI, and from a server with none", () => {
    state.settings = {
      data: { ask: true, meeting_notes: true, chat_source: true },
      isPending: false,
    };
    state.permissions = { data: { permissions: [] }, isPending: false };
    expect(read().catchUp).toBe(false);

    state.permissions = { data: { permissions: ["ai:use"] }, isPending: false };
    state.consent = { data: null, isError: false };
    expect(read().catchUp).toBe(false);
  });
});

describe("useActActions", () => {
  it("lists what the server says this member can ask Frapp to do", () => {
    expect(readActions()).toEqual(["points", "task"]);
    expect(state.actEnabled).toBe(true);
  });

  it("asks nothing while the sheet is closed", () => {
    expect(readActions(false)).toEqual([]);
    expect(state.actEnabled).toBe(false);
  });

  it("asks nothing for a member without ai:act: the server would only refuse", () => {
    state.permissions = { data: { permissions: ["ai:use"] }, isPending: false };
    expect(readActions()).toEqual([]);
    expect(state.actEnabled).toBe(false);
  });

  it("asks nothing, and offers nothing, for a member without Ask", () => {
    state.permissions = { data: { permissions: [] }, isPending: false };
    expect(readActions()).toEqual([]);
    expect(state.actEnabled).toBe(false);
  });
});
