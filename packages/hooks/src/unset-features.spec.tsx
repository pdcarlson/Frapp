/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reads, enabledCalls } = vi.hoisted(() => ({
  reads: {
    zones: [] as unknown[] | undefined,
    documents: [] as unknown[] | undefined,
  },
  enabledCalls: {} as Record<string, boolean | undefined>,
}));

vi.mock("./use-study", () => ({
  useGeofences: (options?: { enabled?: boolean }) => {
    enabledCalls.zones = options?.enabled;
    return { data: options?.enabled ? reads.zones : undefined };
  },
}));
vi.mock("./use-documents", () => ({
  useDocuments: (options?: { enabled?: boolean }) => {
    enabledCalls.documents = options?.enabled;
    return { data: options?.enabled ? reads.documents : undefined };
  },
}));

import {
  selectHiddenUnsetFeatures,
  useHiddenUnsetFeatures,
} from "./unset-features";

const MEMBER = ["members:view", "backwork:upload", "service:log"];
const ALL_ON = () => true;

beforeEach(() => {
  reads.zones = [];
  reads.documents = [];
  for (const key of Object.keys(enabledCalls)) delete enabledCalls[key];
});

describe("selectHiddenUnsetFeatures", () => {
  it("hides study and documents from a member while the chapter has neither", () => {
    expect(
      selectHiddenUnsetFeatures({
        permissions: MEMBER,
        isModuleEnabled: ALL_ON,
        counts: { study: 0, documents: 0 },
      }),
    ).toEqual(new Set(["study", "documents"]));
  });

  it("shows each one once its first item exists", () => {
    expect(
      selectHiddenUnsetFeatures({
        permissions: MEMBER,
        isModuleEnabled: ALL_ON,
        counts: { study: 1, documents: 0 },
      }),
    ).toEqual(new Set(["documents"]));
  });

  it("keeps Documents for whoever can upload, since the upload is on its page", () => {
    expect(
      selectHiddenUnsetFeatures({
        permissions: [...MEMBER, "chapter_docs:upload"],
        isModuleEnabled: ALL_ON,
        counts: { study: 1, documents: 0 },
      }).size,
    ).toBe(0);
  });

  // Zones are made in the web zones tool, which neither Study page links to.
  it("hides Study hours from an officer too, who could only make zones elsewhere", () => {
    expect(
      selectHiddenUnsetFeatures({
        permissions: ["*"],
        isModuleEnabled: ALL_ON,
        counts: { study: 0, documents: 0 },
      }),
    ).toEqual(new Set(["study"]));
  });

  it("hides nothing until permissions, modules and the list have answered", () => {
    const counts = { study: 0, documents: 0 };
    for (const input of [
      { permissions: undefined, isModuleEnabled: ALL_ON, counts },
      { permissions: null, isModuleEnabled: ALL_ON, counts },
      { permissions: MEMBER, isModuleEnabled: undefined, counts },
      { permissions: MEMBER, isModuleEnabled: ALL_ON, counts: {} },
    ]) {
      expect(selectHiddenUnsetFeatures(input).size).toBe(0);
    }
  });

  // No zone can exist or be read while the zones module is off, so Study
  // hours has nowhere to study for a member.
  it("counts a feature whose module is off as empty", () => {
    expect(
      selectHiddenUnsetFeatures({
        permissions: MEMBER,
        isModuleEnabled: (key) => key !== "geofences",
        counts: { documents: 3 },
      }),
    ).toEqual(new Set(["study"]));
  });
});

describe("useHiddenUnsetFeatures", () => {
  it("reads only the lists the viewer can't set up", () => {
    renderHook(() =>
      useHiddenUnsetFeatures([...MEMBER, "chapter_docs:upload"], ALL_ON),
    );
    expect(enabledCalls).toEqual({ zones: true, documents: false });
    renderHook(() => useHiddenUnsetFeatures(["*"], ALL_ON));
    expect(enabledCalls).toEqual({ zones: true, documents: false });
  });

  // The zones route refuses while its module is off, and that's the default
  // in every org archetype, so the read must not fire for nothing.
  it("reads no list whose module is off", () => {
    renderHook(() =>
      useHiddenUnsetFeatures(MEMBER, (key) => key !== "geofences"),
    );
    expect(enabledCalls).toEqual({ zones: false, documents: true });
  });

  it("counts only active zones, the ones the Study pages list", () => {
    reads.zones = [{ id: "z1", is_active: false }];
    reads.documents = [{ id: "d1" }];
    const { result, rerender } = renderHook(() =>
      useHiddenUnsetFeatures(MEMBER, ALL_ON),
    );
    expect(result.current).toEqual(new Set(["study"]));
    reads.zones = [{ id: "z1", is_active: false }, { id: "z2", is_active: true }];
    rerender();
    expect(result.current.size).toBe(0);
  });

  it("reads nothing while permissions or modules load", () => {
    renderHook(() => useHiddenUnsetFeatures(undefined, ALL_ON));
    expect(enabledCalls).toEqual({ zones: false, documents: false });
    renderHook(() => useHiddenUnsetFeatures(MEMBER, undefined));
    expect(enabledCalls).toEqual({ zones: false, documents: false });
  });

  it("hides from the list's answer, and not from a read that hasn't one", () => {
    reads.zones = [{ id: "z1" }];
    const { result, rerender } = renderHook(() =>
      useHiddenUnsetFeatures(MEMBER, ALL_ON),
    );
    expect(result.current).toEqual(new Set(["documents"]));
    reads.documents = undefined;
    rerender();
    expect(result.current.size).toBe(0);
  });
});
