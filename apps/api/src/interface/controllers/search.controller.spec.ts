import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from '../../application/services/search.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '../../domain/constants/permissions';

describe('SearchController', () => {
  let controller: SearchController;
  let searchService: jest.Mocked<Partial<SearchService>>;

  beforeEach(async () => {
    searchService = {
      search: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        {
          provide: SearchService,
          useValue: searchService,
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('search', () => {
    it('should call searchService.search with correct parameters', async () => {
      const mockResult = {
        backwork: [],
        events: [],
        members: [],
        messages: [],
      };
      searchService.search!.mockResolvedValue(mockResult);

      const result = await controller.search('chapter-1', 'test');

      expect(searchService.search).toHaveBeenCalledWith('chapter-1', 'test');
      expect(result).toEqual(mockResult);
    });

    it('should handle null/undefined query by passing an empty string', async () => {
      searchService.search!.mockResolvedValue({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });

      await controller.search('chapter-1', undefined as unknown as string);
      expect(searchService.search).toHaveBeenCalledWith('chapter-1', '');

      await controller.search('chapter-1', null as unknown as string);
      expect(searchService.search).toHaveBeenCalledWith('chapter-1', '');
    });
  });

  describe('Guards', () => {
    it('should apply RequirePermissions decorator', () => {
      const permissions = Reflect.getMetadata('permissions', SearchController);
      expect(permissions).toEqual([SystemPermissions.MEMBERS_VIEW]);
    });

    it('should apply SupabaseAuthGuard, ChapterGuard, and PermissionsGuard', () => {
      const guards = Reflect.getMetadata('__guards__', SearchController);
      expect(guards).toEqual([
        SupabaseAuthGuard,
        ChapterGuard,
        PermissionsGuard,
      ]);
    });
  });
});
