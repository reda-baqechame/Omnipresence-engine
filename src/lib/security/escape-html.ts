export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHexColor(color: string | undefined | null): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  return "#6366f1";
}
