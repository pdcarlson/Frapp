export const REPORT_PDF_RENDERER = 'REPORT_PDF_RENDERER';

/** One table column, mirroring the CSV column descriptors in report-columns.ts. */
export interface ReportPdfColumn {
  key: string;
  header: string;
  /**
   * Relative width weight. Columns share the usable page width in proportion to
   * their weight; omitted weights count as 1. Lets a free-text column (service
   * descriptions) take the room a date column does not need.
   */
  weight?: number;
}

/** Chapter identity rendered into the header band, per spec/behavior/reports.md. */
export interface ReportPdfBranding {
  chapterName: string;
  university: string;
  /**
   * Raw logo bytes, or null when the chapter never uploaded one. The renderer
   * treats an unusable logo as absent rather than failing the export — a broken
   * image must not cost an officer their report.
   */
  logo?: { bytes: Uint8Array; contentType: string | null } | null;
}

export interface ReportPdfDocument {
  /** Report title, e.g. "Attendance Report". */
  title: string;
  /** Scope line under the title, e.g. "2026-01-01 – 2026-05-31 · All members". */
  subtitle?: string;
  /** ISO timestamp stamped into the footer. */
  generatedAt: string;
  columns: ReportPdfColumn[];
  rows: Record<string, unknown>[];
  branding: ReportPdfBranding;
}

export interface IReportPdfRenderer {
  /** Render a paginated, branded PDF and return the encoded bytes. */
  render(document: ReportPdfDocument): Promise<Uint8Array>;
}
