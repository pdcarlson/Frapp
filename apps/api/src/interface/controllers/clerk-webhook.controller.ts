import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClerkWebhookGuard } from '../guards/clerk-webhook.guard';
import { ClerkWebhookDto } from '../dtos/clerk-webhook.dto';
import {
  UserSyncService,
  ClerkUser,
} from '../../application/services/user-sync.service';

@ApiTags('webhooks')
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  constructor(private readonly userSyncService: UserSyncService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClerkWebhookGuard)
  @ApiOperation({ summary: 'Handle webhooks from Clerk' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async handleWebhook(@Body() payload: ClerkWebhookDto) {
    this.logger.log(`Received Clerk webhook: ${payload.type}`);

    switch (payload.type) {
      case 'user.created':
        await this.userSyncService.handleUserCreated(payload.data as ClerkUser);
        break;
      case 'user.updated':
        await this.userSyncService.handleUserUpdated(payload.data as ClerkUser);
        break;
      case 'user.deleted':
        await this.userSyncService.handleUserDeleted(
          payload.data as Partial<ClerkUser>,
        );
        break;
      default:
        this.logger.warn(`Unhandled Clerk webhook type: ${payload.type}`);
    }

    return { received: true };
  }
}
