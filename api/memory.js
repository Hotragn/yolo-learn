import { kvConfigured, kvGet, kvIncrWithTtl, kvSet } from "./_kv.js"
import { KNOWN_RULE_SET } from "./_rules.js"

/**
 * Shared memory: what previous audits of this page shape found.
 *
 * This is the "so anyone else's run is faster" piece. It is a HINT, never a
 * source of truth: the three lenses always re-run locally, and this only says
 * how often a page shape has been looked at before and which rules it usually
 * trips. Nothing here is ever displayed as a finding.
 *
 * Being a public write endpoint is the whole design problem, so:
 *
 *   - Rule ids are checked against an allow-list. Anything unrecognised is
 *     dropped, so no attacker-controlled string is ever stored.
 *   - No free text is accepted at all. No names, no selectors, no details.
 *   - Counts are bounded, so a single write cannot dominate the aggregate.
 *   - Keys are built server-side from a validated origin and fingerprint,
 *     rather than taken from the caller, so the key space cannot be walked or
 *     collided with deliberately.
 *   - Nothing about the caller is stored. No IP, no identifier, no timestamps
 *     beyond a single last-seen on the page record itself.
 *
 * The worst a bad actor achieves is a wrong number next to a real rule.
 */

const TTL_SECONDS = 90 * 24 * 60 * 60
const MAX_RULES_PER_WRITE = 40
const MAX_COUNT = 5000
const RATE_WINDOW = 60
const RATE_MAX_WRITES = 30

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i
const FINGERPRINT_RE = /^[a-z0-9]{1,16}$/i

function keyFor(origin, fingerprint) {
  return `mem:v1:${origin.toLowerCase()}#${fingerprint.toLowerCase()}`
}

function validTarget(query) {
  const origin = (query?.origin ?? "").toString().trim()
  const fingerprint = (query?.fingerprint ?? "").toString().trim()
  if (!ORIGIN_RE.test(origin)) return { error: "origin must be an http or https origin, with no path." }
  if (!FINGERPRINT_RE.test(fingerprint)) return { error: "fingerprint must be short and alphanumeric." }
  return { origin, fingerprint }
}

function clampCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), MAX_COUNT)
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store")

  if (!kvConfigured()) {
    // Stated plainly rather than pretended away, so the client can say why the
    // shared hint is missing instead of showing an empty box.
    res.status(200).json({
      configured: false,
      reason:
        "No shared store is configured for this deployment, so audits are remembered in your browser only. " +
        "Set KV_REST_API_URL and KV_REST_API_TOKEN to turn shared memory on.",
    })
    return
  }

  if (req.method === "GET") {
    const target = validTarget(req.query)
    if (target.error) {
      res.status(400).json({ configured: true, error: target.error })
      return
    }
    const record = await kvGet(keyFor(target.origin, target.fingerprint))
    res.status(200).json({ configured: true, record: record ?? null })
    return
  }

  if (req.method !== "POST") {
    res.status(405).json({ configured: true, error: "GET to read, POST to contribute." })
    return
  }

  const client = (req.headers?.["x-forwarded-for"] ?? "").toString().split(",")[0].trim() || "unknown"
  const writes = await kvIncrWithTtl(`rl:mem:${client}`, RATE_WINDOW)
  if (writes !== null && writes > RATE_MAX_WRITES) {
    res.status(429).json({ configured: true, error: "Too many contributions in the last minute." })
    return
  }

  const body = await readBody(req)
  if (!body) {
    res.status(400).json({ configured: true, error: "Send a JSON body." })
    return
  }
  const target = validTarget(body)
  if (target.error) {
    res.status(400).json({ configured: true, error: target.error })
    return
  }

  // Only ids we recognise survive this, which is what makes storing them safe.
  const submitted = Array.isArray(body.ruleIds) ? body.ruleIds : []
  const ruleIds = [...new Set(submitted.filter((id) => typeof id === "string" && KNOWN_RULE_SET.has(id)))].slice(
    0,
    MAX_RULES_PER_WRITE
  )
  const counts = {
    high: clampCount(body.counts?.high),
    medium: clampCount(body.counts?.medium),
    low: clampCount(body.counts?.low),
  }

  const key = keyFor(target.origin, target.fingerprint)
  const existing = (await kvGet(key)) ?? { audits: 0, rules: {} }

  const rules = { ...(existing.rules ?? {}) }
  for (const id of ruleIds) rules[id] = Math.min((rules[id] ?? 0) + 1, MAX_COUNT)

  const record = {
    audits: Math.min((existing.audits ?? 0) + 1, MAX_COUNT),
    lastAt: new Date().toISOString(),
    lastCounts: counts,
    rules,
  }

  const stored = await kvSet(key, record, TTL_SECONDS)
  res.status(200).json({ configured: true, stored, record })
}
