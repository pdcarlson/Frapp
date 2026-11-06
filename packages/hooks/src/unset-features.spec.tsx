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

  it("keeps each one for whoever can set it up, since setup is the page", () => {
    expect(
      selectHiddenUnsetFeatures({
        permissions: [...MEMBER, "geofences:manage"],
        isModuleEnabled: ALL_ON,
        counts: { study: 0, documents: 0 },
      }),
    ).toEqual(new Set(["documents"]));
    expect(
      selectHiddenUnsetFeatures({
        permissions: ["*"],
        isModuleEnabled: ALL_ON,
        counts: { study: 0, documents: 0 },
      }).size,
    ).toBe(0);
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
  });

  it("reads nothing for an officer who can set both up", () => {
    renderHook(() => useHiddenUnsetFeatures(["*"], ALL_ON));
    expect(enabledCalls).toEqual({ zones: false, documents: false });
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
