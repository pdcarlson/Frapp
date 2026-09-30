import { Module } from '@nestjs/common';
import { ProfilePhotoUrlService } from '../../application/services/profile-photo-url.service';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';

/**
 * One `ProfilePhotoUrlService` for the process. `UserModule` (`/users/me`) and
 * `MemberModule` (the roster, directory and the rest) both sign the same
 * photos, and a provider listed in each would give each its own URL cache:
 * the viewer's own photo would come back as two different signed URLs, and
 * the browser would download it twice.
 */
@Module({
  providers: [
    ProfilePhotoUrlService,
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [ProfilePhotoUrlService],
})
export class ProfilePhotoModule {}
