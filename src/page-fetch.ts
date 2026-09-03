/**
 * Client for /api/fetch-page. Judges never see a raw parse stack: a missing
 * API, an HTML fallback, or a JS-only page all become one clear sentence.
 */

export interface FetchedPage {
  html?: string
  finalUrl?: string
  error?: string
  redirected?: boolean
  bytes?: number
  notes?: string[]
}

export const EXAMPLE_PUBLIC_FORM =
  "https://www.w3.org/WAI/demos/bad/before/survey.html"

export function explainReadFailure(raw: string): string {
  const t = raw.toLowerCase()
  if (
    /unexpected token|not valid json|<!doctype|fetch endpoint did not return json|is \/api\/fetch-page running/i.test(
      raw
    )
  ) {
    return "The page-read service did not answer. Reload this app and try again, or use the W3C survey example."
  }
  if (/too many requests/i.test(t)) {
    return "Too many page reads in the last minute. Wait a moment and try once more."
  }
  if (/no form control|no readable fields|no form on the first|paste the markup around the fields/i.test(t)) {
    return (
      "That URL has no form fields in its HTML. Many sites only draw fields with JavaScript, which this read cannot run. " +
      "Use a page with a real HTML form. The W3C survey example works."
    )
  }
  if (/abort|timed out|timeout/i.test(t)) {
    return "That page took too long to fetch. Try again, or use the W3C survey example."
  }
  if (/could not resolve/i.test(t)) {
    return "That host could not be reached. Check the URL, or use the W3C survey example."
  }
  return raw
}

export async function fetchRemotePage(url: string): Promise<FetchedPage> {
  try {
    const response = await fetch(`/api/fetch-page?url=${encodeURIComponent(url)}`)
    const type = response.headers?.get?.("content-type") ?? ""
    if (type && !/json/i.test(type)) {
      return { error: explainReadFailure("The fetch endpoint did not return JSON.") }
    }
    let body: FetchedPage
    try {
      body = (await response.json()) as FetchedPage
    } catch (err) {
      return { error: explainReadFailure(err instanceof Error ? err.message : String(err)) }
    }
    if (body.error) return { ...body, error: explainReadFailure(body.error) }
    return body
  } catch (err) {
    return { error: explainReadFailure(err instanceof Error ? err.message : String(err)) }
  }
}
