import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { User } from '../../domain/entities/user.entity';

const PROFILES_BUCKET = 'profiles';

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: IStorageProvider,
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
    const storagePath = `chapters/${chapterId}/profiles/${userId}/${filename}`;
    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      PROFILES_BUCKET,
      storagePath,
      contentType,
    );
    return { signedUrl, storagePath };
  }
}
