import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DB } from '../../drizzle/drizzle.provider';
import { users, members } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';

@Injectable()
export class ChapterGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_DB) private db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const chapterId = request.headers['x-chapter-id'];
    const user = request['user'];

    if (!user || !user.sub) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (!chapterId) {
      throw new BadRequestException('Missing x-chapter-id header');
    }

    const result = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(members, eq(users.id, members.userId))
      .where(and(
        eq(users.clerkId, user.sub),
        eq(members.chapterId, chapterId)
      ))
      .limit(1);

    if (result.length === 0) {
      throw new ForbiddenException('User does not have access to this chapter');
    }

    return true;
  }
}
