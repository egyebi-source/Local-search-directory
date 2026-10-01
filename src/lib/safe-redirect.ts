/** Only allow same-site relative paths, so a link can't bounce users to another site. */
export function safeRedirectPath(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
