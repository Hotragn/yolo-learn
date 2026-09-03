import { randomBytes } from "node:crypto"
import { kvConfigured, kvGet, kvSet, kvIncrWithTtl } from "./_kv.js"
import { stripSensitiveMarkup } from "./_sanitize.js"

/**
 * Hold a page snapshot for a couple of minutes so a bookmarklet on a logged-in
 * tab can hand the painted DOM to this origin without sending cookies.
 *
 * The snapshot is HTML only. We strip password and card fields before store.
 */

const MAX_HTML = 400_000
const TTL_SEC = 120
const local = new Map()

function cors(res) {
  res.setHeader("access-control-allow-origin", "*")
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS")
  res.setHeader("access-control-allow-headers", "content-type")
  res.setHeader("cache-control", "no-store")
}

function looksLikeUrl(value) {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

async function putSnap(id, value) {
  const key = `snap:${id}`
  if (kvConfigured()) {
    const ok = await kvSet(key, value, TTL_SEC)
    if (ok) return true
  }
  local.set(id, { value, exp: Date.now() + TTL_SEC * 1000 })
  return true
}

async function takeSnap(id) {
  const key = `snap:${id}`
  if (kvConfigured()) {
    const value = await kvGet(key)
    if (value) {
      await kvSet(key, { used: true }, 10)
      return value
    }
  }
  const row = local.get(id)
  if (!row) return null
  local.delete(id)
  if (row.exp < Date.now()) return null
  return row.value
}

export default async function handler(req, res) {
  cors(res)
  const method = (req.method ?? "GET").toUpperCase()
  if (method === "OPTIONS") {
    res.status(204).end?.()
    if (!res.writableEnded && typeof res.json === "function") res.status(204).json({})
    return
  }

  if (method === "GET") {
    const id = (req.query?.id ?? "").toString().trim()
    if (!id) {
      res.status(400).json({ error: "Pass id." })
      return
    }
    const snap = await takeSnap(id)
    if (!snap || !snap.html) {
      res.status(404).json({ error: "That snapshot expired or was already used." })
      return
    }
    res.status(200).json(snap)
    return
  }

  if (method !== "POST") {
    res.status(405).json({ error: "POST a url and html, or GET with id." })
    return
  }

  const client = (req.headers?.["x-forwarded-for"] ?? "").toString().split(",")[0].trim() || "unknown"
  if (kvConfigured()) {
    const count = await kvIncrWithTtl(`rl:ingest:${client}`, 60)
    if (count !== null && count > 20) {
      res.status(429).json({ error: "Too many captures from this address. Wait a moment." })
      return
    }
  }

  const url = (req.body?.url ?? "").toString().trim()
  const html = (req.body?.html ?? "").toString()
  if (!looksLikeUrl(url)) {
    res.status(400).json({ error: "Pass the page url." })
    return
  }
  if (!html || html.length < 20) {
    res.status(400).json({ error: "Pass the painted HTML from that tab." })
    return
  }
  if (html.length > MAX_HTML) {
    res.status(413).json({ error: "That snapshot is too large." })
    return
  }

  const id = randomBytes(12).toString("hex")
  await putSnap(id, { url, html: stripSensitiveMarkup(html).slice(0, MAX_HTML) })
  res.status(200).json({ id, expiresSec: TTL_SEC })
}
