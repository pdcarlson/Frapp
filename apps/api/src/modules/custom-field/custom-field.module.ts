import { Module } from '@nestjs/common';
import { CustomFieldService } from '../../application/services/custom-field.service';
import { CustomFieldController } from '../../interface/controllers/custom-field.controller';

/**
 * Custom member fields. Owns the read API over `chapter_custom_fields` (the
 * member directory consumes it) and the visibility-filtered value lookup the
 * member profile uses. Write CRUD for the definitions (Settings → Fields, #539)
 * extends the controller later.
 */
@Module({
  controllers: [CustomFieldController],
  providers: [CustomFieldService],
  exports: [CustomFieldService],
})
export class CustomFieldModule {}
