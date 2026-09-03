/** Visible form controls, not a CSRF hidden input that every SPA ships. */
export function hasLearnableControls(html: string): boolean {
  if (!html) return false
  const withoutHidden = html.replace(/<input\b[^>]*type\s*=\s*['"]hidden['"][^>]*>/gi, "")
  return /<(input|select|textarea)\b/i.test(withoutHidden)
}
