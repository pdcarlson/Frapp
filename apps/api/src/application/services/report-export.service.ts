import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  REPORT_PDF_RENDERER,
  type IReportPdfRenderer,
  type ReportPdfColumn,
} from '../../domain/adapters/pdf.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '../../domain/repositories/chapter.repository.interface';
import {
  REPORT_TITLES,
  type ReportKind,
} from '../../interface/controllers/report-columns';

/** Private bucket holding generated report artifacts (see the reports_bucket migration). */
export const REPORTS_BUCKET = 'reports';

/** spec/behavior/reports.md: "API returns a signed download URL (valid for 1 hour)". */
export const REPORT_URL_TTL_SECONDS = 3600;

const BRANDING_BUCKET = 'branding';

export interface ReportExportResult {
  /** Signed, time-limited download URL. Never a public object URL. */
  url: string;
  /** ISO timestamp at which `url` stops working. */
  expires_at: string;
  expires_in: number;
  /** Suggested download filename for the browser. */
  filename: string;
  /** Bucket-relative object path, for support/debugging. */
  storage_path: string;
  row_count: number;
}

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
    @Inject(REPORT_PDF_RENDERER) private readonly renderer: IReportPdfRenderer,
  ) {}

  /**
   * Render `rows` into a branded PDF, store it in the private reports bucket,
   * and hand back a one-hour signed URL.
   *
   * The object is written under a chapter-scoped prefix with a random suffix:
   * the bucket has no RLS policies and is reached only through API-issued
   * signed URLs, so an unguessable key keeps one chapter's export from being
   * reachable by another even if a path were ever leaked into a log.
   */
  async exportPdf(
    chapterId: string,
    kind: ReportKind,
    columns: ReportPdfColumn[],
    rows: Record<string, unknown>[],
    subtitle?: string,
  ): Promise<ReportExportResult> {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) throw new NotFoundException('Chapter not found');

    const generatedAt = new Date();
    const bytes = await this.renderer.render({
      title: REPORT_TITLES[kind],
      subtitle,
      generatedAt: generatedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      columns,
      rows,
      branding: {
        chapterName: chapter.name,
        university: chapter.university,
        logo: await this.loadLogo(chapter.logo_path),
      },
    });

    const day = generatedAt.toISOString().slice(0, 10);
    const filename = `frapp-${kind}-report-${day}.pdf`;
    const storagePath = `chapters/${chapterId}/reports/${kind}-${day}-${randomUUID()}.pdf`;

    await this.storage.uploadFile(
      REPORTS_BUCKET,
      storagePath,
      bytes,
      'application/pdf',
    );
    const url = await this.storage.getSignedDownloadUrl(
      REPORTS_BUCKET,
      storagePath,
      REPORT_URL_TTL_SECONDS,
    );

    return {
      url,
      expires_at: new Date(
        generatedAt.getTime() + REPORT_URL_TTL_SECONDS * 1000,
      ).toISOString(),
      expires_in: REPORT_URL_TTL_SECONDS,
      filename,
      storage_path: storagePath,
      row_count: rows.length,
    };
  }

  /**
   * Fetch the chapter logo for the PDF header. The logo is decorative: if it is
   * missing, unreadable, or storage is having a bad day, the report still ships
   * without it rather than failing an officer's export.
   */
  private async loadLogo(
    logoPath: string | null,
  ): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
    if (!logoPath) return null;
    try {
      const bytes = await this.storage.downloadFile(BRANDING_BUCKET, logoPath);
      return bytes ? { bytes, contentType: null } : null;
    } catch (error) {
      this.logger.warn(
        `Could not load chapter logo "${logoPath}" for report export: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
