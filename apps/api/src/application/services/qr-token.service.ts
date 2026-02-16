import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface QrPayload {
  eventId: string;
  chapterId: string;
  nonce: string;
}

@Injectable()
export class QrTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  generateToken(eventId: string, chapterId: string): string {
    const payload: QrPayload = {
      eventId,
      chapterId,
      nonce: Math.random().toString(36).substring(2),
    };

    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('CLERK_SECRET_KEY'), // Reusing this secret for now
      expiresIn: '30s', // Short expiration
    });
  }

  validateToken(token: string): QrPayload {
    try {
      return this.jwtService.verify(token, {
        secret: this.configService.get<string>('CLERK_SECRET_KEY'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired QR code');
    }
  }
}
