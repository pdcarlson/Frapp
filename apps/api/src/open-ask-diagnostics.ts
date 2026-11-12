import { askDiagnosticsContext } from './application/services/ask/ask-diagnostics.service';
import { openSealedRows } from './open-sealed-rows';

/**
 * Opens exchanges kept by Ask's beta diagnostics window (#4315): rows of
 * `ai_diagnostics_exchanges`. The reader and its rules: `open-sealed-rows.ts`.
 */
openSealedRows(askDiagnosticsContext);
