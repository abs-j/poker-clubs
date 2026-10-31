/** One way to match a person's name across results, avatars and the roster. */
export function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
