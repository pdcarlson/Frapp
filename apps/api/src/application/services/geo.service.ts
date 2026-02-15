import { Injectable } from '@nestjs/common';

@Injectable()
export class GeoService {
  /**
   * Check if a point is inside a polygon using the Ray-Casting algorithm.
   * @param point The point to check {lat, lng}
   * @param polygon Array of points defining the polygon [{lat, lng}, ...]
   */
  isPointInPolygon(
    point: { lat: number; lng: number },
    polygon: { lat: number; lng: number }[],
  ): boolean {
    const x = point.lat;
    const y = point.lng;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lat,
        yi = polygon[i].lng;
      const xj = polygon[j].lat,
        yj = polygon[j].lng;

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }

    return inside;
  }
}
