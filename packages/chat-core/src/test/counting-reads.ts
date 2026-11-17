/**
 * `text` as a string that counts the work done on it: one for each property
 * read (a character, its length or a method) and, for each string a method
 * returns, its length, since it was copied. A walk that rescans the rest of
 * the body shows as a count that grows with the square of its length.
 */
export function countingReads(text: string): { body: string; reads: () => number } {
  let reads = 0;
  const body = new Proxy(Object(text) as object, {
    get(owner, key) {
      reads += 1;
      const value: unknown = Reflect.get(owner, key);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, owner, args);
        if (typeof result === "string") reads += result.length;
        return result;
      };
    },
  });
  return { body: body as unknown as string, reads: () => reads };
}
