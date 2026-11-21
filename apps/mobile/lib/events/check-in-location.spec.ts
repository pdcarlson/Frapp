import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ OS: "ios" as "ios" | "android" }));
const hasServicesEnabledAsync = vi.fn();
const enableNetworkProviderAsync = vi.fn();
const requestForegroundPermissionsAsync = vi.fn();
const getCurrentPositionAsync = vi.fn();
const getLastKnownPositionAsync = vi.fn();

vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("expo-location", () => ({
  hasServicesEnabledAsync: () => hasServicesEnabledAsync(),
  enableNetworkProviderAsync: () => enableNetworkProviderAsync(),
  requestForegroundPermissionsAsync: () => requestForegroundPermissionsAsync(),
  getForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: (options: unknown) =>
    getCurrentPositionAsync(options),
  getLastKnownPositionAsync: (options: unknown) =>
    getLastKnownPositionAsync(options),
  Accuracy: { Balanced: 3, High: 4 },
}));

import {
  CHECK_IN_GPS_TIMEOUT_MS,
  getCheckInLocation,
  LAST_KNOWN_MAX_AGE_MS,
  locationBlockerCopy,
} from "./check-in-location";

const position = (accuracy: number | null) => ({
  coords: { latitude: 42.73, longitude: -73.68, accuracy },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  platform.OS = "ios";
  hasServicesEnabledAsync.mockResolvedValue(true);
  requestForegroundPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
  });
  getCurrentPositionAsync.mockResolvedValue(position(12));
  getLastKnownPositionAsync.mockResolvedValue(null);
});

describe("getCheckInLocation", () => {
  it("uses a fix the screen already holds, without asking anything", async () => {
    const warm = { lat: 1, lng: 2, accuracy_meters: 5 };
    await expect(getCheckInLocation(warm)).resolves.toEqual({
      kind: "fix",
      fix: warm,
    });
    expect(requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("asks for permission in context, then takes a GPS fix", async () => {
    await expect(getCheckInLocation()).resolves.toEqual({
      kind: "fix",
      fix: { lat: 42.73, lng: -73.68, accuracy_meters: 12 },
    });
    expect(requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 4 });
  });

  it("asks Android to turn location on when it is off, and goes on when accepted", async () => {
    platform.OS = "android";
    hasServicesEnabledAsync.mockResolvedValue(false);
    enableNetworkProviderAsync.mockResolvedValue(undefined);
    await expect(getCheckInLocation()).resolves.toMatchObject({ kind: "fix" });
    expect(enableNetworkProviderAsync).toHaveBeenCalledTimes(1);
  });

  it("says location is off when Android's dialog is declined", async () => {
    platform.OS = "android";
    hasServicesEnabledAsync.mockResolvedValue(false);
    enableNetworkProviderAsync.mockRejectedValue(new Error("declined"));
    await expect(getCheckInLocation()).resolves.toEqual({
      kind: "none",
      blocker: "services_off",
    });
    expect(requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("says location is off on iOS without trying a dialog it doesn't have", async () => {
    hasServicesEnabledAsync.mockResolvedValue(false);
    await expect(getCheckInLocation()).resolves.toEqual({
      kind: "none",
      blocker: "services_off",
    });
    expect(enableNetworkProviderAsync).not.toHaveBeenCalled();
  });

  it("tells a refusal the OS will ask about again from one it won't", async () => {
    requestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    });
    await expect(getCheckInLocation()).resolves.toEqual({
      kind: "none",
      blocker: "declined",
    });
    requestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });
    await expect(getCheckInLocation()).resolves.toEqual({
      kind: "none",
      blocker: "denied",
    });
  });

  it("falls back to a recent last known position when the GPS fix times out", async () => {
    vi.useFakeTimers();
    getCurrentPositionAsync.mockReturnValueOnce(new Promise(() => undefined));
    getLastKnownPositionAsync.mockResolvedValue(position(40));
    const result = getCheckInLocation();
    await vi.advanceTimersByTimeAsync(CHECK_IN_GPS_TIMEOUT_MS);
    await expect(result).resolves.toEqual({
      kind: "fix",
      fix: { lat: 42.73, lng: -73.68, accuracy_meters: 40 },
    });
    expect(getLastKnownPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: LAST_KNOWN_MAX_AGE_MS }),
    );
  });

  it("then a coarse fix, and only then no location", async () => {
    getCurrentPositionAsync
      .mockRejectedValueOnce(new Error("no gps"))
      .mockResolvedValueOnce(position(null));
    await expect(getCheckInLocation()).resolves.toEqual({
      kind: "fix",
      fix: { lat: 42.73, lng: -73.68 },
    });
    expect(getCurrentPositionAsync).toHaveBeenLastCalledWith({ accuracy: 3 });

    getCurrentPositionAsync.mockRejectedValue(new Error("nothing"));
    await expect(getCheckInLocation()).resolves.toEqual({
      kind: "none",
      blocker: "no_fix",
    });
  });
});

describe("locationBlockerCopy", () => {
  it("offers Android's own switch, and Settings on iOS, when location is off", () => {
    expect(locationBlockerCopy("services_off", "android").action).toBe(
      "turn_on",
    );
    expect(locationBlockerCopy("services_off", "ios").action).toBe(
      "settings",
    );
  });

  it("sends a refusal the OS won't ask about again to Settings, and asks again otherwise", () => {
    expect(locationBlockerCopy("denied", "ios")).toMatchObject({
      action: "settings",
      actionLabel: "Open Settings",
    });
    expect(locationBlockerCopy("declined", "ios").action).toBe("retry");
    expect(locationBlockerCopy("no_fix", "ios").action).toBe("retry");
  });
});
