import { MEMBER_ORDER_NUMBER_MAX } from "./field-limits";

/**
 * A member's order number (#3939) from the text an officer typed: an integer
 * from 1 to {@link MEMBER_ORDER_NUMBER_MAX}, `null` for a blank field (no
 * number), and `undefined` for anything else. Web's profile sheet and class
 * editor and mobile's member sheet (#3991) read a typed number through this,
 * so they refuse the same input the API's DTO does.
 */
export function parseOrderNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 1 && value <= MEMBER_ORDER_NUMBER_MAX ? value : undefined;
}

/** What a form says under an order number {@link parseOrderNumber} refuses. */
export const ORDER_NUMBER_INVALID_MESSAGE =
  "A whole number from 1 up, or blank for none.";
