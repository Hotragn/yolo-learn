/** Drop credential and payment controls before we store or learn a snapshot. */
export function stripSensitiveMarkup(html) {
  if (!html) return ""
  return html
    .replace(/<input\b[^>]*type\s*=\s*['"]password['"][^>]*>/gi, "")
    .replace(/<input\b[^>]*autocomplete\s*=\s*['"]?(current-password|new-password|cc-[^'"\s>]+)['"]?[^>]*>/gi, "")
}
