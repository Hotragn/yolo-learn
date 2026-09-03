import { lookup } from "node:dns/promises"
import { kvConfigured, kvIncrWithTtl } from "./_kv.js"

/**
 * Fetch a public page so the browser can audit it.
 *
 * The only thing a static page cannot do is read another origin, so that is
 * the only thing this does. It returns markup; it does not analyse anything.
 * The three lenses still run in the user's browser, in the sandboxed iframe
 * that already existed, which is what gives real layout and a real cascade
 * without anyone running a headless Chrome.
 *
 * Stylesheets are inlined here rather than left as <link> tags, because the
 * iframe that renders them has a different origin and would be refused. Their
 * url() references are rewritten to absolute so backgrounds still resolve,
 * since "is there a background image behind this text" decides whether a
 * contrast ratio is computable at all.
 *
 * SERVER-SIDE FETCH IS AN SSRF SINK. A URL is attacker-controlled input, and
 * a naive fetch here would happily read the cloud metadata endpoint or a
 * service on the private network. So: scheme allow-list, DNS resolution
 * checked against every private range, and redirects followed one hop at a
 * time with the same check applied to each. A hostname that resolves to
 * 127.0.0.1 is rejected, which is the case a string-only blocklist misses.
 */

const MAX_HTML_BYTES = 3_000_000
const MAX_CSS_BYTES = 600_000
const MAX_STYLESHEETS = 10
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 12_000

const UA =
  "Mozilla/5.0 (compatible; YoloLearnAudit/1.0; +https://yolo-learn.vercel.app) " +
  "fetches pages so a browser can audit their accessibility"

/** Private, loopback, link-local, CGNAT, multicast and unspecified ranges. */
function isBlockedIPv4(ip) {
  const p = ip.split(".").map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a >= 224) return true // multicast and reserved
  return false
}

function isBlockedIPv6(ip) {
  const v = ip.toLowerCase().split("%")[0]
  if (v === "::" || v === "::1") return true
  // IPv4-mapped: defer to the v4 rules.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedIPv4(mapped[1])
  if (/^f[cd]/.test(v)) return true // fc00::/7 unique local
  if (/^fe[89ab]/.test(v)) return true // fe80::/10 link-local
  if (/^ff/.test(v)) return true // multicast
  return false
}

async function assertPublic(urlString) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    throw new Error("That is not a URL.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https are fetched, not ${url.protocol.replace(":", "")}.`)
  }
  if (!url.hostname) throw new Error("That URL has no host.")

  // Resolve rather than pattern-match the hostname. "localtest.me" and plenty
  // of real hostnames resolve to 127.0.0.1, which a string check waves through.
  let records
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    throw new Error(`Could not resolve ${url.hostname}.`)
  }
  if (!records.length) throw new Error(`Could not resolve ${url.hostname}.`)
  for (const { address, family } of records) {
    const blocked = family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address)
    if (blocked) {
      throw new Error(
        `${url.hostname} resolves to ${address}, which is a private or reserved address. Only public pages are fetched.`
      )
    }
  }
  return url
}

async function readCapped(response, cap) {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    chunks.reduce(
      (acc, c) => {
        acc.buf.set(c, acc.at)
        return { buf: acc.buf, at: acc.at + c.byteLength }
      },
      { buf: new Uint8Array(Math.min(size, cap)), at: 0 }
    ).buf
  )
}

/** Follow redirects one hop at a time, re-checking each destination. */
async function safeFetch(url, signal, accept) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      signal,
      redirect: "manual",
      headers: { "user-agent": UA, accept },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) return { response, finalUrl: current }
      // A redirect is a fresh URL from an untrusted source, so it gets the
      // same treatment as the original.
      current = await assertPublic(new URL(location, current).toString())
      continue
    }
    return { response, finalUrl: current }
  }
  throw new Error("Too many redirects.")
}

function rewriteCssUrls(css, sheetUrl) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote, ref) => {
    if (/^(data:|https?:|#)/i.test(ref)) return whole
    try {
      return `url(${quote}${new URL(ref, sheetUrl).toString()}${quote})`
    } catch {
      return whole
    }
  })
}

/**
 * A per-instance rate limit.
 *
 * Deliberately modest about what this is: serverless instances come and go and
 * scale out, so this is a floor rather than a real limit. It stops one client
 * hammering a single warm instance, and nothing more. Proper limiting needs
 * shared state, which is one of the two honest arguments for adding a store.
 */
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 20
const hits = new Map()

/**
 * Prefer the shared store, because a per-instance counter on a platform that
 * scales out is a floor rather than a limit. Falls back to the in-memory one
 * when no store is configured, so the endpoint is never left unmetered.
 */
async function overLimit(key) {
  if (kvConfigured()) {
    const count = await kvIncrWithTtl(`rl:fetch:${key}`, RATE_WINDOW_MS / 1000)
    if (count !== null) return count > RATE_MAX
  }
  return rateLimited(key)
}

function rateLimited(key) {
  const now = Date.now()
  const seen = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  seen.push(now)
  hits.set(key, seen)
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k)
    }
  }
  return seen.length > RATE_MAX
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store")

  const client =
    (req.headers?.["x-forwarded-for"] ?? "").toString().split(",")[0].trim() || "unknown"
  if (await overLimit(client)) {
    res.status(429).json({
      error: "Too many requests from this address in the last minute. Wait a moment and try again.",
    })
    return
  }

  const target = (req.query?.url ?? "").toString().trim()
  if (!target) {
    res.status(400).json({ error: "Pass a url query parameter." })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const url = await assertPublic(target)
    const { response, finalUrl } = await safeFetch(url, controller.signal, "text/html,*/*")

    if (!response.ok) {
      res.status(200).json({
        error: `${finalUrl.hostname} answered ${response.status} ${response.statusText}.`,
      })
      return
    }
    const type = response.headers.get("content-type") ?? ""
    if (!/text\/html|application\/xhtml/i.test(type)) {
      res.status(200).json({ error: `That URL returned ${type || "an unknown type"}, not HTML.` })
      return
    }

    let html = await readCapped(response, MAX_HTML_BYTES)
    const notes = []

    // Scripts cannot run in the sandbox anyway. Stripping them keeps the
    // console clean and stops any speculative prefetching.
    const scriptCount = (html.match(/<script\b/gi) ?? []).length
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/?>/gi, "")
    if (scriptCount) notes.push(`Removed ${scriptCount} script tag(s). Anything they would have rendered is not here.`)

    // Inline stylesheets: the iframe is a different origin and would refuse
    // to load them, and without the cascade there is nothing to measure.
    const links = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => /rel\s*=\s*['"]?stylesheet/i.test(tag))
      .slice(0, MAX_STYLESHEETS)

    let cssBudget = MAX_CSS_BYTES
    let inlined = 0
    for (const tag of links) {
      const href = tag.match(/href\s*=\s*['"]([^'"]+)['"]/i)?.[1]
      if (!href || cssBudget <= 0) continue
      try {
        const sheetUrl = await assertPublic(new URL(href, finalUrl).toString())
        const sheet = await safeFetch(sheetUrl, controller.signal, "text/css,*/*")
        if (!sheet.response.ok) continue
        const css = await readCapped(sheet.response, cssBudget)
        cssBudget -= css.length
        html = html.replace(tag, `<style data-yolo-inlined="${href}">${rewriteCssUrls(css, sheetUrl.toString())}</style>`)
        inlined++
      } catch {
        // A stylesheet that cannot be fetched is a measurement gap, not a
        // failure. It is reported so the audit can say so.
        notes.push(`Could not fetch the stylesheet at ${href}, so some colours may not match the real page.`)
      }
    }
    if (inlined) notes.push(`Inlined ${inlined} stylesheet(s) so the cascade is real.`)
    if (links.length === MAX_STYLESHEETS) notes.push(`Only the first ${MAX_STYLESHEETS} stylesheets were fetched.`)

    // Relative URLs have to resolve against the real page, not against us.
    if (!/<base\b/i.test(html)) {
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${finalUrl.toString()}">`)
        : `<base href="${finalUrl.toString()}">` + html
    }

    res.status(200).json({
      html,
      finalUrl: finalUrl.toString(),
      redirected: finalUrl.toString() !== url.toString(),
      bytes: html.length,
      notes,
    })
  } catch (err) {
    res.status(200).json({ error: err instanceof Error ? err.message : "Could not fetch that page." })
  } finally {
    clearTimeout(timer)
  }
}
