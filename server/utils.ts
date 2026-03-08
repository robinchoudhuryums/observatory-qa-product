/**
 * Shared server utilities.
 */

/**
 * Normalize an array field from AI output — coerce any objects to strings.
 * AI providers sometimes return objects where string arrays are expected.
 */
export function normalizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((item: unknown) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      if (typeof obj.text === "string") return obj.text;
      if (typeof obj.name === "string") return obj.name;
      if (typeof obj.task === "string") return obj.task;
      return JSON.stringify(item);
    }
    return String(item ?? "");
  });
}
