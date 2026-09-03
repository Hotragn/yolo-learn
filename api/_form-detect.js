/**
 * Visible form controls, not a CSRF hidden input that every SPA ships.
 * Used to decide whether a GET already has a task to learn, or we need JS.
 */
export function hasLearnableControls(html) {
  if (!html) return false
  const withoutHidden = html.replace(/<input\b[^>]*type\s*=\s*['"]hidden['"][^>]*>/gi, "")
  return /<(input|select|textarea)\b/i.test(withoutHidden)
}
