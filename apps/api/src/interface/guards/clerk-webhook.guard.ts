import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';

@Injectable()
export class ClerkWebhookGuard implements CanActivate {
  private readonly logger = new Logger(ClerkWebhookGuard.name);

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const headers = request.headers;
    const payload = JSON.stringify(request.body);

    const svix_id = headers['svix-id'] as string;
    const svix_timestamp = headers['svix-timestamp'] as string;
    const svix_signature = headers['svix-signature'] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      this.logger.error('Missing Svix headers');
      throw new UnauthorizedException('Missing Svix headers');
    }

    const secret = this.configService.get<string>('CLERK_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('CLERK_WEBHOOK_SECRET is not configured');
      throw new Error('Webhook secret not configured');
    }

    const wh = new Webhook(secret);

    try {
      wh.verify(payload, {
        'svix-id': svix_id,
        'svix-timestamp': svix_timestamp,
        'svix-signature': svix_signature,
      });
      return true;
    } catch (err) {
      this.logger.error('Webhook verification failed', err);
      throw new UnauthorizedException('Invalid signature');
    }
  }
}
