import { Test, TestingModule } from '@nestjs/testing';
import { QrTokenService } from './qr-token.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

describe('QrTokenService', () => {
  let service: QrTokenService;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('test-secret'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrTokenService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<QrTokenService>(QrTokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateToken', () => {
    it('should return a signed token', () => {
      mockJwtService.sign.mockReturnValue('signed-token');
      const token = service.generateToken('event-1', 'chapter-1');
      expect(token).toBe('signed-token');
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'event-1', chapterId: 'chapter-1' }),
        expect.any(Object),
      );
    });
  });

  describe('validateToken', () => {
    it('should return payload if token is valid', () => {
      const payload = { eventId: 'event-1', chapterId: 'chapter-1' };
      mockJwtService.verify.mockReturnValue(payload);

      const result = service.validateToken('valid-token');
      expect(result).toEqual(payload);
    });

    it('should throw UnauthorizedException if token is invalid', () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      expect(() => service.validateToken('invalid-token')).toThrow(
        UnauthorizedException,
      );
    });
  });
});
