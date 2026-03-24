import * as path from 'path';
import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { User } from '../../domain/entities/user.entity';

const PROFILES_BUCKET = 'profiles';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    return this.userRepo.update(id, data);
  }

  async requestAvatarUploadUrl(
    chapterId: string,
    userId: string,
    filename: string,
    contentType: string,
  ): Promise<{ signedUrl: string; storagePath: string }> {
    const ext = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(
        `Content type "${contentType}" is not allowed`,
      );
    }

    const storagePath = `chapters/${chapterId}/profiles/${userId}/${path.basename(filename)}`;
    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      PROFILES_BUCKET,
      storagePath,
      contentType,
    );
    return { signedUrl, storagePath };
  }
}
