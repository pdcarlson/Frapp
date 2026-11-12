/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPermissionHidden,
  useIsPermissionHidden,
} from "./use-hidden-permissions";

const h = vi.hoisted(() => ({
  heldOff: new Set<string>(),
  consent: { data: undefined as unknown },
}));

vi.mock("@repo/validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/validation")>()),
  isBetaOffModule: (module: string) => h.heldOff.has(module),
}));

vi.mock("./use-ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-ai")>()),
  useAiConsent: () => h.consent,
}));

beforeEach(() => {
  h.heldOff.clear();
  h.consent = { data: undefined };
});

describe("isPermissionHidden (#4504)", () => {
  it("hides the AI switches until the server says it has AI", () => {
    expect(isPermissionHidden("ai:use", false)).toBe(true);
    expect(isPermissionHidden("ai:act", undefined)).toBe(true);
    expect(isPermissionHidden("ai:use", true)).toBe(false);
  });

  it("hides the Meetings switches while the module is held off for the beta", () => {
    h.heldOff.add("meetings");
    expect(isPermissionHidden("meetings:record", true)).toBe(true);
    expect(isPermissionHidden("meetings:view", true)).toBe(true);
  });

  it("shows the Meetings switches while the module is offered", () => {
    expect(isPermissionHidden("meetings:record", true)).toBe(false);
  });

  it("leaves every other switch alone, whatever is held off", () => {
    h.heldOff.add("meetings");
    expect(isPermissionHidden("events:create", false)).toBe(false);
  });
});

describe("useIsPermissionHidden (#4504)", () => {
  it("hides the AI switches while the AI read has not answered", () => {
    const { result } = renderHook(() => useIsPermissionHidden());
    expect(result.current("ai:use")).toBe(true);
  });

  it("hides the AI switches on a server without AI", () => {
    h.consent = { data: null };
    const { result } = renderHook(() => useIsPermissionHidden());
    expect(result.current("ai:act")).toBe(true);
  });

  it("shows the AI switches once the server says it has AI", () => {
    h.consent = { data: { version: 1 } };
    const { result } = renderHook(() => useIsPermissionHidden());
    expect(result.current("ai:use")).toBe(false);
    expect(result.current("events:create")).toBe(false);
  });
});
