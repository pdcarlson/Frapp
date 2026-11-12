import { aiReportContext } from './application/services/ai/ai-report.service';
import { openSealedRows } from './open-sealed-rows';

/**
 * Opens reports of AI-made text (#4315): rows of `ai_reports`, selected with
 * their `id`. The reader and its rules: `open-sealed-rows.ts`.
 */
openSealedRows(aiReportContext);
