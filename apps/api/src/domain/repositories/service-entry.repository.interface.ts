import { ServiceEntry } from '../entities/service-entry.entity';

export const SERVICE_ENTRY_REPOSITORY = 'SERVICE_ENTRY_REPOSITORY';

export interface IServiceEntryRepository {
  findById(id: string, chapterId: string): Promise<ServiceEntry | null>;
  findByChapter(chapterId: string): Promise<ServiceEntry[]>;
  findByUser(chapterId: string, userId: string): Promise<ServiceEntry[]>;
  create(data: Partial<ServiceEntry>): Promise<ServiceEntry>;
  update(
    id: string,
    chapterId: string,
    data: Partial<ServiceEntry>,
  ): Promise<ServiceEntry>;
  delete(id: string, chapterId: string): Promise<void>;
}
