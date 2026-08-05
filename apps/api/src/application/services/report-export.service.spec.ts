import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  REPORTS_BUCKET,
  REPORT_URL_TTL_SECONDS,
  ReportExportService,
} from './report-export.service';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { REPORT_PDF_RENDERER } from '../../domain/adapters/pdf.interface';
import { ROSTER_COLUMNS } from '../../interface/controllers/report-columns';

describe('ReportExportService', () => {
  let service: ReportExportService;
  let chapterRepo: { findById: jest.Mock };
  let storage: {
    uploadFile: jest.Mock;
    downloadFile: jest.Mock;
    getSignedDownloadUrl: jest.Mock;
  };
  let renderer: { render: jest.Mock };

  const chapter = {
    id: 'chapter-1',
    name: 'Tau Nu',
    university: 'Rensselaer Polytechnic Institute',
    logo_path: null as string | null,
  };

  const rows = [{ name: 'John Doe', email: 'john@example.com' }];

  beforeEach(async () => {
    chapterRepo = { findById: jest.fn().mockResolvedValue({ ...chapter }) };
    storage = {
      uploadFile: jest.fn().mockResolvedValue(undefined),
      downloadFile: jest.fn().mockResolvedValue(null),
      getSignedDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://storage.example/signed'),
    };
    renderer = {
      render: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportExportService,
        { provide: CHAPTER_REPOSITORY, useValue: chapterRepo },
        { provide: STORAGE_PROVIDER, useValue: storage },
        { provide: REPORT_PDF_RENDERER, useValue: renderer },
      ],
    }).compile();

    service = module.get(ReportExportService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('stores the PDF privately and returns a one-hour signed URL', async () => {
    const result = await service.exportPdf(
      'chapter-1',
      'roster',
      ROSTER_COLUMNS,
      rows,
      'Current members',
    );

    expect(storage.uploadFile).toHaveBeenCalledWith(
      REPORTS_BUCKET,
      expect.stringMatching(
        /^chapters\/chapter-1\/reports\/roster-\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.pdf$/,
      ),
      new Uint8Array([1, 2, 3]),
      'application/pdf',
    );
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
      REPORTS_BUCKET,
      expect.any(String),
      REPORT_URL_TTL_SECONDS,
      result.filename,
    );
    expect(result.url).toBe('https://storage.example/signed');
    expect(result.expires_in).toBe(3600);
    expect(result.row_count).toBe(1);
    expect(result.filename).toMatch(
      /^frapp-roster-report-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
  });

  it('signs the URL for exactly one hour past generation', async () => {
    const before = Date.now();
    const result = await service.exportPdf(
      'chapter-1',
      'roster',
      ROSTER_COLUMNS,
      rows,
    );
    const expiry = new Date(result.expires_at).getTime();

    expect(expiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
  });

  it('passes chapter branding and the scope line to the renderer', async () => {
    await service.exportPdf(
      'chapter-1',
      'roster',
      ROSTER_COLUMNS,
      rows,
      'Current members',
    );

    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Member Roster',
        subtitle: 'Current members',
        columns: ROSTER_COLUMNS,
        rows,
        branding: expect.objectContaining({
          chapterName: 'Tau Nu',
          university: 'Rensselaer Polytechnic Institute',
          logo: null,
        }),
      }),
    );
  });

  it('does not reach for a logo when the chapter has none', async () => {
    await service.exportPdf('chapter-1', 'roster', ROSTER_COLUMNS, rows);

    expect(storage.downloadFile).not.toHaveBeenCalled();
  });

  it('loads the logo from the branding bucket when one is set', async () => {
    chapterRepo.findById.mockResolvedValue({
      ...chapter,
      logo_path: 'chapters/chapter-1/branding/logo.png',
    });
    storage.downloadFile.mockResolvedValue(new Uint8Array([9, 9]));

    await service.exportPdf('chapter-1', 'roster', ROSTER_COLUMNS, rows);

    expect(storage.downloadFile).toHaveBeenCalledWith(
      'branding',
      'chapters/chapter-1/branding/logo.png',
    );
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        branding: expect.objectContaining({
          logo: { bytes: new Uint8Array([9, 9]), contentType: null },
        }),
      }),
    );
  });

  it('still exports when the logo cannot be fetched', async () => {
    chapterRepo.findById.mockResolvedValue({
      ...chapter,
      logo_path: 'chapters/chapter-1/branding/logo.png',
    });
    storage.downloadFile.mockRejectedValue(new Error('storage unavailable'));

    const result = await service.exportPdf(
      'chapter-1',
      'roster',
      ROSTER_COLUMNS,
      rows,
    );

    expect(result.url).toBe('https://storage.example/signed');
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        branding: expect.objectContaining({ logo: null }),
      }),
    );
  });

  it('rejects an unknown chapter before writing anything', async () => {
    chapterRepo.findById.mockResolvedValue(null);

    await expect(
      service.exportPdf('missing', 'roster', ROSTER_COLUMNS, rows),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(renderer.render).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('gives each export a distinct object key', async () => {
    await service.exportPdf('chapter-1', 'roster', ROSTER_COLUMNS, rows);
    await service.exportPdf('chapter-1', 'roster', ROSTER_COLUMNS, rows);

    const [first, second] = storage.uploadFile.mock.calls.map(
      (call) => call[1] as string,
    );
    expect(first).not.toBe(second);
  });
});
