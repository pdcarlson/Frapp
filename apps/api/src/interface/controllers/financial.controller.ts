import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { FinancialService } from '../../application/services/financial.service';
import { UserService } from '../../application/services/user.service';
import { CreateInvoiceDto } from '../dtos/financial.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { PERMISSIONS } from '../../domain/constants/permissions';
import type { RequestWithUser } from '../auth.types';

@ApiTags('financials')
@Controller('financials')
@UseGuards(ClerkAuthGuard, ChapterGuard, PermissionsGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class FinancialController {
  constructor(
    private readonly financialService: FinancialService,
    private readonly userService: UserService,
  ) {}

  @Post('invoices')
  @ApiOperation({
    summary: 'Create an invoice for a member',
  })
  @RequirePermissions(PERMISSIONS.FINANCIALS_CREATE_INVOICE)
  async createInvoice(
    @Req() req: RequestWithUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.financialService.createInvoice({
      ...dto,
      chapterId,
      description: dto.description || null,
      dueDate: new Date(dto.dueDate),
    });
  }

  @Get('invoices/my')
  @ApiOperation({ summary: 'Get my invoices' })
  async getMyInvoices(@Req() req: RequestWithUser) {
    const user = await this.userService.findByClerkId(req.user.sub);
    return this.financialService.getUserInvoices(user.id);
  }

  @Post('invoices/:id/pay')
  @ApiOperation({ summary: 'Generate payment link for an invoice' })
  async payInvoice(@Req() req: RequestWithUser, @Param('id') id: string) {
    // In a real app, we'd verify the chapter has a valid Stripe setup
    // For now we assume platform collected or simulated
    const successUrl = `http://localhost:3000/dashboard/financials?success=true`;
    const cancelUrl = `http://localhost:3000/dashboard/financials?canceled=true`;

    // We need the customer ID. For MVP, we assume the user has one stored or we create one on fly.
    // Since our user entity doesn't strictly enforce a stored stripeCustomerId yet (only chapters do),
    // we might need to fetch it or create it.
    // For this MVP, let's assume we pass a placeholder or the user entity has it.
    // I'll use a placeholder 'cus_UserPlaceholder' if not present, but in prod this needs sync.
    const stripeCustomerId = 'cus_UserPlaceholder';

    return {
      url: await this.financialService.generatePaymentLink(
        id,
        stripeCustomerId,
        successUrl,
        cancelUrl,
      ),
    };
  }
}
