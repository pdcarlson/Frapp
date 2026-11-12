import { createInterface } from 'node:readline';
import { AiTextCipherError, openAiText } from '#domain/utils/ai-text-cipher';
import { aiStoredTextKeyRing } from './config/ai-stored-text-config';

/**
 * The one reader behind `npm run ai:open-diagnostics` and
 * `npm run ai:open-reports` (#4315), for the Frapp team, on a team member's
 * own machine. How and when to use them: `docs/ops/ai-stored-text.md`.
 *
 * Reads one JSON object per line on stdin, `{"chapter_id": …, "sealed": …}`
 * plus the row's `id` when it was selected, and writes each opened row as
 * one line of JSON on stdout, with that id first when there is one. The key
 * comes from `AI_STORED_TEXT_KEY` in this process's environment, never from
 * an argument, so it does not land in shell history. Nothing is written
 * anywhere else, and no API serves this text.
 */
function parseRow(line: string): {
  id: string | null;
  chapter_id: string;
  sealed: string;
} {
  const row = JSON.parse(line) as {
    id?: unknown;
    chapter_id?: unknown;
    sealed?: unknown;
  };
  if (typeof row.chapter_id !== 'string' || typeof row.sealed !== 'string') {
    throw new Error('not a row');
  }
  return {
    id: typeof row.id === 'string' ? row.id : null,
    chapter_id: row.chapter_id,
    sealed: row.sealed,
  };
}

async function openRows(context: (chapterId: string) => string): Promise<void> {
  const ring = aiStoredTextKeyRing();
  if (!ring) {
    throw new Error('Set AI_STORED_TEXT_KEY in this shell first.');
  }
  let failed = 0;
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    try {
      const row = parseRow(line);
      const opened = JSON.parse(
        openAiText(ring, row.sealed, context(row.chapter_id)),
      ) as object;
      process.stdout.write(
        `${JSON.stringify(row.id ? { id: row.id, ...opened } : opened)}\n`,
      );
    } catch (error) {
      failed += 1;
      // The reason only: never the row.
      const reason =
        error instanceof AiTextCipherError
          ? error.reason
          : 'not a row: expected one JSON object with chapter_id and sealed';
      process.stderr.write(`A row could not be opened (${reason}).\n`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

/** Runs the reader with the context the rows were sealed to. */
export function openSealedRows(context: (chapterId: string) => string): void {
  openRows(context).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Could not open the rows.'}\n`,
    );
    process.exitCode = 1;
  });
}
