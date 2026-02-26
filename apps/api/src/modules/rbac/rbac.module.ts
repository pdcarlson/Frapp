import { Module } from '@nestjs/common';
import { RbacService } from '../../application/services/rbac.service';
import { RbacController } from '../../interface/controllers/rbac.controller';
import { ChapterModule } from '../chapter/chapter.module';

@Module({
  imports: [ChapterModule],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
