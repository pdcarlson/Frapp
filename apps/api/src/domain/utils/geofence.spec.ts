import { isValidZone, pointInPolygon } from './geofence';

/**
 * These `pointInPolygon` cases moved here from `study.service.spec.ts` with #994,
 * when event check-in became the function's second consumer and it moved out of
 * the study service into `domain/utils`.
 */
describe('pointInPolygon', () => {
  const square: { lat: number; lng: number }[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 0 },
  ];

  it('returns true for point inside polygon', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it('returns false for point outside polygon', () => {
    expect(pointInPolygon(15, 15, square)).toBe(false);
  });

  it('returns false for empty or insufficient polygon', () => {
    expect(pointInPolygon(5, 5, [])).toBe(false);
    expect(pointInPolygon(5, 5, [{ lat: 0, lng: 0 }])).toBe(false);
    expect(
      pointInPolygon(5, 5, [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).toBe(false);
  });

  it('handles complex polygon', () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 0 },
      { lat: 5, lng: 10 },
    ];
    expect(pointInPolygon(5, 3, triangle)).toBe(true);
    expect(pointInPolygon(0, 0, triangle)).toBe(false);
  });

  it('excludes a point just outside a realistic chapter-house polygon', () => {
    // ~80m square around a plausible campus building.
    const house = [
      { lat: 42.7295, lng: -73.6785 },
      { lat: 42.7295, lng: -73.6775 },
      { lat: 42.7302, lng: -73.6775 },
      { lat: 42.7302, lng: -73.6785 },
    ];
    expect(pointInPolygon(42.7298, -73.678, house)).toBe(true);
    // Across the street — the case the geofence exists to reject.
    expect(pointInPolygon(42.731, -73.678, house)).toBe(false);
  });
});

describe('isValidZone', () => {
  const triangle = [
    { lat: 0, lng: 0 },
    { lat: 1, lng: 0 },
    { lat: 0, lng: 1 },
  ];

  it('accepts a polygon of three or more well-formed points', () => {
    expect(isValidZone(triangle)).toBe(true);
  });

  it('rejects absent and non-array zones', () => {
    expect(isValidZone(null)).toBe(false);
    expect(isValidZone(undefined)).toBe(false);
    expect(isValidZone('not a zone')).toBe(false);
    expect(isValidZone({ lat: 0, lng: 0 })).toBe(false);
  });

  it('rejects a polygon that cannot enclose anything', () => {
    expect(isValidZone([])).toBe(false);
    expect(
      isValidZone([
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]),
    ).toBe(false);
  });

  it('rejects malformed members rather than treating the zone as absent', () => {
    // The distinction that matters: a corrupted zone must be a hard failure at
    // the call site, not a silent "this event has no geofence".
    expect(isValidZone([...triangle, { lat: 'x', lng: 0 }])).toBe(false);
    expect(isValidZone([...triangle, { lat: Number.NaN, lng: 0 }])).toBe(false);
    expect(isValidZone([...triangle, null])).toBe(false);
    expect(isValidZone([...triangle, { lat: 1 }])).toBe(false);
  });
});
