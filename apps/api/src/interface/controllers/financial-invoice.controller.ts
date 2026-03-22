import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FinancialInvoiceService } from '../../application/services/financial-invoice.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import {
  CreateFinancialInvoiceDto,
  UpdateFinancialInvoiceDto,
  TransitionInvoiceStatusDto,
} from '../dtos/financial-invoice.dto';

@ApiTags('Financial Invoices')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('invoices')
export class FinancialInvoiceController {
  constructor(
    private readonly invoiceService: FinancialInvoiceService,
    private readonly rbacService: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List invoices (billing: all, member: own)' })
  @ApiQuery({ name: 'user_id', required: false })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query('user_id') filterUserId?: string,
  ) {
    const canViewAll = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.BILLING_VIEW],
    );
    if (filterUserId) {
      if (filterUserId !== userId && !canViewAll) {
        throw new ForbiddenException('Access denied to these invoices');
      }
      return this.invoiceService.findByUser(filterUserId, chapterId);
    }
    if (canViewAll) {
      return this.invoiceService.findByChapter(chapterId);
    }
    return this.invoiceService.findByUser(userId, chapterId);
  }

  @Get('overdue')
  @RequirePermissions(SystemPermissions.BILLING_VIEW)
  @ApiOperation({ summary: 'List overdue invoices (OPEN past due_date)' })
  async listOverdue(@CurrentChapterId() chapterId: string) {
    return this.invoiceService.findOverdue(chapterId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  async getOne(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const invoice = await this.invoiceService.findById(id, chapterId);
    const canViewAll = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.BILLING_VIEW],
    );
    if (invoice.user_id !== userId && !canViewAll) {
      throw new ForbiddenException('Access denied to this invoice');
    }
    return invoice;
  }

  @Post()
  @RequirePermissions(SystemPermissions.BILLING_MANAGE)
  @ApiOperation({ summary: 'Create a member invoice' })
  async create(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateFinancialInvoiceDto,
  ) {
    return this.invoiceService.create({
      chapter_id: chapterId,
      ...dto,
    });
  }

  @Patch(':id')
  @RequirePermissions(SystemPermissions.BILLING_MANAGE)
  @ApiOperation({ summary: 'Update a draft invoice' })
  async update(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFinancialInvoiceDto,
  ) {
    return this.invoiceService.update(id, chapterId, dto);
  }

  @Post(':id/status')
  @RequirePermissions(SystemPermissions.BILLING_MANAGE)
  @ApiOperation({ summary: 'Transition invoice status (OPEN, PAID, VOID)' })
  async transitionStatus(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: TransitionInvoiceStatusDto,
  ) {
    return this.invoiceService.transitionStatus(id, chapterId, dto.status);
  }

  @Get(':id/transactions')
  @RequirePermissions(SystemPermissions.BILLING_VIEW)
  @ApiOperation({ summary: 'Get transactions for an invoice' })
  async getInvoiceTransactions(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
  ) {
    return this.invoiceService.getInvoiceTransactions(id, chapterId);
  }
}
