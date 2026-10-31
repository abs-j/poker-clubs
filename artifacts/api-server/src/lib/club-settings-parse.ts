// Validation for the club settings form. Pure, so it can be unit tested.

export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length >= 2 && text.length <= 60 ? text : null;
}

export function cleanCurrency(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) return null;
  const code = value.toUpperCase();
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return code;
  } catch {
    return null;
  }
}

export function cleanTimezone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

export const MAX_GUIDELINES = 8000;

/** Plain text, up to 8,000 characters. Empty clears it. Returns undefined when too long. */
export function cleanGuidelines(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text === "") return null;
  return text.length <= MAX_GUIDELINES ? text : undefined;
}
