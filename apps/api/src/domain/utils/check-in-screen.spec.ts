import { distanceMeters } from '@repo/validation';
import {
  CHECK_IN_SCREEN_RADIUS_M,
  canAnchorCheckIn,
  isLocatedScreen,
  isNearCheckInScreen,
} from './check-in-screen';

describe('check-in near the QR screen', () => {
  const screen = { lat: 42.7298, lng: -73.678, accuracy_m: 0 };
  const north = (meters: number) => ({
    lat: screen.lat + meters / 111_195,
    lng: screen.lng,
  });

  it('measures room-scale distances to within a meter', () => {
    expect(distanceMeters(screen, north(100))).toBeCloseTo(100, 0);
    // Due east at 42.7° N, where a degree of longitude is shorter.
    const east = { lat: screen.lat, lng: screen.lng + 0.001 };
    expect(distanceMeters(screen, east)).toBeCloseTo(81.7, 0);
  });

  it('is 100 yards with two perfect fixes', () => {
    expect(CHECK_IN_SCREEN_RADIUS_M).toBeCloseTo(100 * 0.9144, 5);
    expect(isNearCheckInScreen(screen, north(91))).toBe(true);
    expect(isNearCheckInScreen(screen, north(92))).toBe(false);
  });

  it('adds each phone accuracy up to 50 m', () => {
    const blurry = { ...screen, accuracy_m: 500 };
    expect(
      isNearCheckInScreen(blurry, { ...north(190), accuracy_m: 900 }),
    ).toBe(true);
    expect(
      isNearCheckInScreen(blurry, { ...north(193), accuracy_m: 900 }),
    ).toBe(false);
  });

  it('ignores a missing or nonsense member accuracy', () => {
    expect(
      isNearCheckInScreen(screen, { ...north(95), accuracy_m: Number.NaN }),
    ).toBe(false);
    expect(isNearCheckInScreen(screen, { ...north(95), accuracy_m: -5 })).toBe(
      false,
    );
  });

  it('anchors the room only from a fix within 100 m', () => {
    expect(canAnchorCheckIn(12)).toBe(true);
    expect(canAnchorCheckIn(100)).toBe(true);
    expect(canAnchorCheckIn(101)).toBe(false);
    expect(canAnchorCheckIn(undefined)).toBe(false);
    expect(canAnchorCheckIn(0)).toBe(false);
  });

  it('anchors only a row with a location', () => {
    expect(isLocatedScreen({ lat: 1, lng: 2, accuracy_m: 10 })).toBe(true);
    expect(isLocatedScreen({ lat: null, lng: null, accuracy_m: null })).toBe(
      false,
    );
  });
});
