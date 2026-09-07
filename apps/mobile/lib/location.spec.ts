import { beforeEach, describe, expect, it, vi } from "vitest";

const getForegroundPermissionsAsync = vi.fn();
const requestForegroundPermissionsAsync = vi.fn();
const getCurrentPositionAsync = vi.fn();

vi.mock("expo-location", () => ({
  getForegroundPermissionsAsync: () => getForegroundPermissionsAsync(),
  requestForegroundPermissionsAsync: () => requestForegroundPermissionsAsync(),
  getCurrentPositionAsync: (options: unknown) =>
    getCurrentPositionAsync(options),
  Accuracy: { Balanced: 3, High: 4 },
}));

import {
  accuracyMetersOf,
  latLngOf,
  readForegroundFix,
  readForegroundPermission,
  requestForegroundPermission,
  requireForegroundFix,
} from "./location";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 42.73, lng: 0, longitude: -73.68 },
  });
});

describe("readForegroundPermission", () => {
  it("reads the current grant without prompting", async () => {
    getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });

    await expect(readForegroundPermission()).resolves.toEqual({
      granted: false,
      canAskAgain: true,
    });
    // The primer has to explain the prompt *before* it appears, so this path
    // must never trigger one.
    expect(requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe("requestForegroundPermission", () => {
  it("asks for While-Using only", async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: false,
    });

    await expect(requestForegroundPermission()).resolves.toEqual({
      granted: true,
      canAskAgain: false,
    });
    expect(requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe("accuracyMetersOf", () => {
  it("returns a positive finite reading", () => {
    expect(accuracyMetersOf(12.5)).toBe(12.5);
  });

  it("omits null, undefined, zero, negative, and non-finite values", () => {
    expect(accuracyMetersOf(null)).toBeUndefined();
    expect(accuracyMetersOf(undefined)).toBeUndefined();
    expect(accuracyMetersOf(0)).toBeUndefined();
    expect(accuracyMetersOf(-1)).toBeUndefined();
    expect(accuracyMetersOf(Number.NaN)).toBeUndefined();
    expect(accuracyMetersOf(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("latLngOf", () => {
  it("drops accuracy_meters so undeclared-key POSTs stay legal", () => {
    expect(
      latLngOf({ lat: 42.73, lng: -73.68, accuracy_meters: 12 }),
    ).toEqual({ lat: 42.73, lng: -73.68 });
  });
});

describe("readForegroundFix", () => {
  it("reads a Balanced-accuracy fix, never High", async () => {
    await expect(readForegroundFix()).resolves.toEqual({
      lat: 42.73,
      lng: -73.68,
    });
    expect(getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
  });

  it("includes accuracy_meters when the position carries a usable reading", async () => {
    getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 42.73, longitude: -73.68, accuracy: 8 },
    });

    await expect(readForegroundFix()).resolves.toEqual({
      lat: 42.73,
      lng: -73.68,
      accuracy_meters: 8,
    });
  });

  it("omits accuracy_meters when the provider reports null or zero", async () => {
    getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 42.73, longitude: -73.68, accuracy: null },
    });
    await expect(readForegroundFix()).resolves.toEqual({
      lat: 42.73,
      lng: -73.68,
    });

    getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 42.73, longitude: -73.68, accuracy: 0 },
    });
    await expect(readForegroundFix()).resolves.toEqual({
      lat: 42.73,
      lng: -73.68,
    });
  });
});

describe("requireForegroundFix", () => {
  it("returns the fix once permission is granted", async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: false,
    });
    getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 42.73, longitude: -73.68, accuracy: 15 },
    });

    await expect(requireForegroundFix("nope")).resolves.toEqual({
      lat: 42.73,
      lng: -73.68,
      accuracy_meters: 15,
    });
  });

  it("throws the caller's own copy on refusal, and never reads a position", async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });

    await expect(
      requireForegroundFix("This event checks you in by location."),
    ).rejects.toThrow("This event checks you in by location.");
    expect(getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});
