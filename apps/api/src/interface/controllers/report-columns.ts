import type { ReportPdfColumn } from '../../domain/adapters/pdf.interface';

/**
 * Column descriptors shared by the CSV writer and the PDF renderer, so the two
 * export formats can never drift apart on which columns exist or how they are
 * labelled. `weight` is PDF-only page-layout metadata; `toCSV` ignores it.
 */
export const ATTENDANCE_COLUMNS: ReportPdfColumn[] = [
  { key: 'member_name', header: 'Member Name', weight: 1.3 },
  { key: 'event_name', header: 'Event Name', weight: 1.6 },
  { key: 'event_date', header: 'Date', weight: 0.9 },
  { key: 'status', header: 'Status', weight: 0.7 },
  { key: 'check_in_time', header: 'Check-in Time', weight: 1 },
];

export const POINTS_COLUMNS: ReportPdfColumn[] = [
  { key: 'member_name', header: 'Member Name', weight: 1.2 },
  { key: 'total_points', header: 'Total Points', weight: 0.6 },
  { key: 'breakdown_by_category', header: 'Breakdown by Category', weight: 2.6 },
];

export const ROSTER_COLUMNS: ReportPdfColumn[] = [
  { key: 'name', header: 'Name', weight: 1.2 },
  { key: 'email', header: 'Email', weight: 1.6 },
  { key: 'roles', header: 'Roles', weight: 1.2 },
  { key: 'join_date', header: 'Join Date', weight: 0.8 },
  { key: 'point_balance', header: 'Point Balance', weight: 0.7 },
];

export const SERVICE_COLUMNS: ReportPdfColumn[] = [
  { key: 'member_name', header: 'Member Name', weight: 1.2 },
  { key: 'date', header: 'Date', weight: 0.8 },
  { key: 'duration_minutes', header: 'Duration (minutes)', weight: 0.9 },
  { key: 'description', header: 'Description', weight: 2.2 },
  { key: 'status', header: 'Status', weight: 0.7 },
];

/** The four report kinds the export endpoints expose. */
export type ReportKind = 'attendance' | 'points' | 'roster' | 'service';

export const REPORT_COLUMNS: Record<ReportKind, ReportPdfColumn[]> = {
  attendance: ATTENDANCE_COLUMNS,
  points: POINTS_COLUMNS,
  roster: ROSTER_COLUMNS,
  service: SERVICE_COLUMNS,
};

/** Human title rendered into the PDF header band. */
export const REPORT_TITLES: Record<ReportKind, string> = {
  attendance: 'Attendance Report',
  points: 'Points Report',
  roster: 'Member Roster',
  service: 'Service Hours Report',
};
