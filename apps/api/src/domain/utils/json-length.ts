/**
 * The length of `value` written as JSON, in the UTF-16 code units every
 * `@MaxLength` in the API counts, or `Infinity` when it can't be written
 * (a cycle, a `BigInt`), which no limit admits. How the API sizes a free-form
 * `jsonb` field a client sends (`@MaxJsonLength` on a DTO, and a chat card's
 * payload in `ChatService.sendMessage`).
 */
export function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Infinity;
  }
}
