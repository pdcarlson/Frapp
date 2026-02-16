import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MemberService } from '../../application/services/member.service';
import { MemberResponseDto, UpdateMemberRolesDto } from '../dtos/member.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { PERMISSIONS } from '../../domain/constants/permissions';

@ApiTags('Members')
@Controller('members')
@UseGuards(ClerkAuthGuard, ChapterGuard, PermissionsGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get()
  @ApiOperation({ summary: 'List all members in the chapter' })
  @ApiResponse({ status: 200, type: [MemberResponseDto] })
  async getMembers(@Headers('x-chapter-id') chapterId: string) {
    return this.memberService.getMembersByChapter(chapterId);
  }

  @Patch(':id/roles')
  @ApiOperation({ summary: 'Assign roles to a member' })
  @RequirePermissions(PERMISSIONS.MEMBERS_MANAGE_ROLES)
  @ApiResponse({ status: 200, type: MemberResponseDto })
  async updateRoles(
    @Param('id') memberId: string,
    @Headers('x-chapter-id') chapterId: string,
    @Body() dto: UpdateMemberRolesDto,
  ) {
    const member = await this.memberService.getMember(memberId);
    if (member.chapterId !== chapterId) {
      throw new ForbiddenException('Member does not belong to this chapter');
    }

    return this.memberService.assignRoles(memberId, dto.roleIds);
  }
}
