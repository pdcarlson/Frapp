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

@ApiTags('webhooks')
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClerkWebhookGuard)
  @ApiOperation({ summary: 'Handle webhooks from Clerk' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  handleWebhook(@Body() payload: ClerkWebhookDto) {
    this.logger.log(`Received Clerk webhook: ${payload.type}`);
    // Logic for handling different event types will go here
    return { received: true };
  }
}
