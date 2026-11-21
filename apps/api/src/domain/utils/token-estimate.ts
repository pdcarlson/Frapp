/**
 * A rough token count for text Frapp is about to send, for the spend
 * reservation and for the scripted adapter's usage figures. English prose
 * runs near four characters a token; this rounds up. The provider's own count
 * is what the ledger records after the call, so this only has to be close
 * enough for a cap to hold.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
