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

describe("readForegroundFix", () => {
  it("reads a Balanced-accuracy fix, never High", async () => {
    await expect(readForegroundFix()).resolves.toEqual({
      lat: 42.73,
      lng: -73.68,
    });
    expect(getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
  });
});

describe("requireForegroundFix", () => {
  it("returns the fix once permission is granted", async () => {
    requestForegroundPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: false,
    });

    await expect(requireForegroundFix("nope")).resolves.toEqual({
      lat: 42.73,
      lng: -73.68,
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
