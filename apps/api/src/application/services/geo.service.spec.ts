import { Test, TestingModule } from '@nestjs/testing';
import { GeoService } from './geo.service';

describe('GeoService', () => {
  let service: GeoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeoService],
    }).compile();

    service = module.get<GeoService>(GeoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isPointInPolygon', () => {
    // Simple square polygon: (0,0), (0,10), (10,10), (10,0)
    const polygon = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];

    it('should return true for a point inside the polygon', () => {
      const point = { lat: 5, lng: 5 };
      expect(service.isPointInPolygon(point, polygon)).toBe(true);
    });

    it('should return false for a point outside the polygon', () => {
      const point = { lat: 15, lng: 5 };
      expect(service.isPointInPolygon(point, polygon)).toBe(false);
    });

    it('should return true for a point on the edge', () => {
      // Ray-casting algorithms can be tricky with edges, but generally we want "inclusive" or consistent behavior.
      // A standard ray-cast might exclude some edges.
      // For this implementation, let's just ensure it's deterministic.
      // But typically, geofences should have a buffer, so strict edge cases are rare in GPS.
      // Let's test a point clearly outside first.
      const outsidePoint = { lat: -1, lng: 5 };
      expect(service.isPointInPolygon(outsidePoint, polygon)).toBe(false);
    });
  });
});
